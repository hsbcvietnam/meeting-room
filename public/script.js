// app.js (copy this in place of your current file)
const API_BASE = "";

// --- Firebase Setup (CDN ESM) ---
/*
  This file must be loaded with:
  <script type="module" src="/path/to/app.js"></script>
*/
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where,
  doc,
  addDoc,
  deleteDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCUOwtJomajsCtH2t3s2E2JDI5Uxe1r3To",
  authDomain: "thg-booking.firebaseapp.com",
  projectId: "thg-booking",
  storageBucket: "thg-booking.firebasestorage.app",
  messagingSenderId: "935148814356",
  appId: "1:935148814356:web:9f06d58b3752dd8f1fe701"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const bookingsCol = collection(db, "bookings");

// time slots: 07:00 to 22:00, 30-minute steps
const START_HOUR = 7;  // 07:00
const END_HOUR = 22;   // 22:00
const SLOT_MINUTES = 30;
const SLOT_HEIGHT_PX = 28; // must match --slot-height in CSS

let rooms = [];
let selectedRoomId = null;
let weekStartDate = null; // Date object
let weekDates = [];       // ["YYYY-MM-DD", ...]
let bookings = [];
let editingBookingId = null;

// DOM elements
const datePicker = document.getElementById("datePicker");
const calendarGrid = document.getElementById("calendarGrid");
const newBookingBtn = document.getElementById("newBookingBtn");

const roomTabsContainer = document.getElementById("roomTabs");
const weekLabel = document.getElementById("weekLabel");

const bookingModal = document.getElementById("bookingModal");
const closeModalBtn = document.getElementById("closeModalBtn");
const cancelBtn = document.getElementById("cancelBtn");
const deleteBtn = document.getElementById("deleteBtn");
const modalTitle = document.getElementById("modalTitle");

const bookingForm = document.getElementById("bookingForm");
const bookingDateInput = document.getElementById("bookingDate");
const roomSelect = document.getElementById("roomSelect");
const meetingTypeSelect = document.getElementById("meetingType");
const peopleCountInput = document.getElementById("peopleCount");
const jobNameInput = document.getElementById("jobName");
const startTimeInput = document.getElementById("startTime");
const endTimeInput = document.getElementById("endTime");
const formError = document.getElementById("formError");
const bookerInput = document.getElementById("booker");

// emojis for room tabs
const ROOM_EMOJIS = {
  "Labrador": "🦮",
  "Border Collie": "🐕‍🦺",
  "Rottweiler": "🐕",
  "Shiba": "🦊",
  "Poodle": "🐩"
};

// --- Init ---
document.addEventListener("DOMContentLoaded", async () => {
  await loadRooms();
  initDatePicker();
  attachEvents();
});

function attachEvents() {
  datePicker.addEventListener("change", () => {
    const date = datePicker.value;
    if (!date) return;
    setWeekFromDateString(date);
    refreshBookings();
  });

  newBookingBtn.addEventListener("click", () => openModalForNewBooking());
  closeModalBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);

  deleteBtn.addEventListener("click", async () => {
    if (!editingBookingId) return;
    const b = bookings.find((bk) => String(bk.id) === String(editingBookingId));
    const label = b ? `"${b.jobName}"` : "this booking";
    if (!confirm(`Release booking ${label}?`)) return;
    await deleteBooking(editingBookingId);
    closeModal();
  });

  bookingForm.addEventListener("submit", handleFormSubmit);
}

// --- Rooms loading & tabs ---

async function loadRooms() {
  // keep existing rooms fetch (assumes your API provides rooms)
  const res = await fetch(`${API_BASE}/api/rooms`);
  rooms = await res.json();
  if (rooms.length > 0) {
    selectedRoomId = rooms[0].id;
    setBodyRoomClass(rooms[0].name);
  }
  renderRoomOptions();
  renderRoomTabs();
}

function renderRoomOptions() {
  roomSelect.innerHTML = "";
  rooms.forEach((room) => {
    const opt = document.createElement("option");
    opt.value = room.id;
    const emoji = ROOM_EMOJIS[room.name] || "";
    opt.textContent = `${emoji ? emoji + " " : ""}${room.name}${room.hasTv ? " (TV)" : ""}`;
    roomSelect.appendChild(opt);
  });
}

function renderRoomTabs() {
  roomTabsContainer.innerHTML = "";
  rooms.forEach((room) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "room-tab";
    if (room.id === selectedRoomId) btn.classList.add("active");

    const emojiSpan = document.createElement("span");
    emojiSpan.className = "emoji";
    emojiSpan.textContent = ROOM_EMOJIS[room.name] || "🐶";

    const textSpan = document.createElement("span");
    textSpan.textContent = room.name;

    btn.appendChild(emojiSpan);
    btn.appendChild(textSpan);

    btn.addEventListener("click", () => {
      selectedRoomId = room.id;
      setBodyRoomClass(room.name);
      renderRoomTabs();
      renderCalendar();
    });

    roomTabsContainer.appendChild(btn);
  });
}

function setBodyRoomClass(roomName) {
  const key = roomName.toLowerCase().replace(/\s+/g, "-");
  document.body.setAttribute("data-room", key);
}

// --- Week handling ---

function initDatePicker() {
  const today = new Date();
  const iso = toISODate(today);
  datePicker.value = iso;
  setWeekFromDate(today);
  refreshBookings();
}

function setWeekFromDateString(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  setWeekFromDate(d);
}

function setWeekFromDate(dateObj) {
  // Monday as week start
  const day = dateObj.getDay(); // 0 (Sun) - 6 (Sat)
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(dateObj);
  monday.setDate(dateObj.getDate() + diff);

  weekStartDate = monday;
  weekDates = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    weekDates.push(toISODate(d));
  }

  updateWeekLabel();
}

function updateWeekLabel() {
  if (!weekStartDate || weekDates.length === 0) {
    weekLabel.textContent = "";
    return;
  }

  const endDate = new Date(weekStartDate);
  endDate.setDate(weekStartDate.getDate() + 6);

  const startStr = formatFullDate(weekStartDate);
  const endStr = formatFullDate(endDate);
  weekLabel.textContent = `Tuần: ${startStr} – ${endStr}`;
}

// --- Bookings ---

async function refreshBookings() {
  if (!weekDates.length) return;
  const startDate = weekDates[0];
  const endDate = weekDates[6];

  // Firestore query for the week range (date stored as "YYYY-MM-DD")
  const qBookings = query(
    bookingsCol,
    where("date", ">=", startDate),
    where("date", "<=", endDate)
  );

  const snap = await getDocs(qBookings);

  bookings = snap.docs.map((d) => ({
    id: d.id,
    ...d.data()
  }));

  renderCalendar();
}

// New layout: header + body

function renderCalendar() {
  calendarGrid.innerHTML = "";
  if (!weekDates.length || selectedRoomId === null || selectedRoomId === undefined) return;

  // Header row
  const header = document.createElement("div");
  header.className = "calendar-grid-header";

  const timeHeaderCell = document.createElement("div");
  timeHeaderCell.className = "calendar-header-cell time-cell header";
  timeHeaderCell.textContent = "Time";
  header.appendChild(timeHeaderCell);

  weekDates.forEach((dateStr) => {
    const cell = document.createElement("div");
    cell.className = "calendar-header-cell";

    const d = new Date(dateStr + "T00:00:00");
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
    const dayNum = String(d.getDate()).padStart(2, "0");

    const line1 = document.createElement("div");
    line1.className = "header-day";
    line1.textContent = weekday;

    const line2 = document.createElement("div");
    line2.className = "header-date";
    line2.textContent = dayNum;

    cell.appendChild(line1);
    cell.appendChild(line2);

    header.appendChild(cell);
  });

  calendarGrid.appendChild(header);

  // Body
  const body = document.createElement("div");
  body.className = "calendar-body";

  const dayStartMin = START_HOUR * 60;
  const dayEndMin = END_HOUR * 60;
  const slots = (dayEndMin - dayStartMin) / SLOT_MINUTES;

  // Time column
  const timeCol = document.createElement("div");
  timeCol.className = "time-column";

  for (let i = 0; i < slots; i++) {
    const minutes = dayStartMin + i * SLOT_MINUTES;
    const timeLabel = minutesToTime(minutes);
    const slot = document.createElement("div");
    slot.className = "time-slot-label";
    slot.textContent = timeLabel;
    timeCol.appendChild(slot);
  }

  body.appendChild(timeCol);

  // Day columns
  weekDates.forEach((dateStr) => {
    const dayCol = document.createElement("div");
    dayCol.className = "day-column";
    dayCol.dataset.date = dateStr;

    // Make entire day column a drop target
    dayCol.addEventListener("dragover", (e) => e.preventDefault());
    dayCol.addEventListener("drop", (e) => handleDropOnDay(e, dateStr));

    // bookings for this day + room
    const dayBookings = bookings.filter(
      (b) => Number(b.roomId) === Number(selectedRoomId) && b.date === dateStr
    );

    dayBookings.forEach((b) => {
      const startMin = timeToMinutes(b.startTime);
      const endMin = timeToMinutes(b.endTime);
      const durationMin = endMin - startMin; // in minutes

      const offsetMin = startMin - dayStartMin;
      const topPx = (offsetMin / SLOT_MINUTES) * SLOT_HEIGHT_PX;
      const heightPx = (durationMin / SLOT_MINUTES) * SLOT_HEIGHT_PX;

      const tag = document.createElement("div");
      tag.className = "booking-tag";
      if (b.meetingType === "Internal") tag.classList.add("internal");
      else tag.classList.add("external");

      // Position + height
      tag.style.top = `${topPx + 1}px`;          // tiny offset from grid line
      tag.style.height = `${heightPx - 1}px`;    // almost full slot height

      // Compact mode: 30-min meetings => job name only
      if (durationMin <= 30) {
        tag.classList.add("compact");
      }

      tag.title = "Click to view / edit";
      tag.draggable = true;

      // drag-to-move (store string id)
      tag.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", `move:${String(b.id)}`);
      });

      // click-to-edit
      tag.addEventListener("click", () => {
        openModalForEdit(b);
      });

      // Title: always job name
      const title = document.createElement("div");
      title.className = "booking-title";
      title.textContent = b.jobName;
      tag.appendChild(title);

      // Meta line: depends on duration
      const hasPeople =
        b.peopleCount && String(b.peopleCount).trim() !== "" &&
        !isNaN(Number(b.peopleCount));

      const bookerName = (b.booker || "").trim();

      let metaText = "";

      // 30 minutes or less → only job name (no meta)
      if (durationMin <= 30) {
        metaText = "";
      }

      // 45–60 minutes → Booker • X ppl
      else if (durationMin > 30 && durationMin <= 60) {
        if (bookerName) {
          metaText = bookerName;
          if (hasPeople) metaText += ` • ${b.peopleCount} ppl`;
        } else if (hasPeople) {
          // fallback if no booker but people count exists
          metaText = `${b.peopleCount} ppl`;
        }
      }

      // > 60 minutes → Booker • HH:MM–HH:MM • X ppl
      else {
        if (bookerName) {
          metaText = bookerName;
          if (b.startTime && b.endTime) {
            metaText += ` • ${b.startTime}–${b.endTime}`;
          }
          if (hasPeople) metaText += ` • ${b.peopleCount} ppl`;
        } else {
          // fallback if no booker given
          metaText = `${b.startTime}–${b.endTime}`;
          if (hasPeople) metaText += ` • ${b.peopleCount} ppl`;
        }
      }

      if (metaText) {
        const meta = document.createElement("div");
        meta.className = "booking-meta";
        meta.textContent = metaText;
        tag.appendChild(meta);
      }

      dayCol.appendChild(tag);
    });

    body.appendChild(dayCol);
  });

  calendarGrid.appendChild(body);
}

// --- Drag to move (keep duration, snap to 30 min) ---

async function handleDropOnDay(e, newDate) {
  e.preventDefault();
  const raw = e.dataTransfer.getData("text/plain");
  if (!raw || !raw.startsWith("move:")) return;

  const id = raw.slice(5); // keep as string (Firestore doc id)
  const booking = bookings.find((b) => String(b.id) === String(id));
  if (!booking) return;

  const dayStartMin = START_HOUR * 60;
  const dayEndMin = END_HOUR * 60;
  const slots = (dayEndMin - dayStartMin) / SLOT_MINUTES;

  const rect = e.currentTarget.getBoundingClientRect();
  let offsetY = e.clientY - rect.top;
  if (offsetY < 0) offsetY = 0;
  const maxY = slots * SLOT_HEIGHT_PX;
  if (offsetY > maxY) offsetY = maxY;

  // rowFraction: how many 30-min rows down we are (e.g. 0.5 = halfway)
  const rowFraction = offsetY / SLOT_HEIGHT_PX;

  // each 30-min row = 2 * 15-min steps
  let quarterSteps = Math.round(rowFraction * 2); // 0,1,2,...

  // clamp so there's at least 15 minutes left in the day
  const totalQuarterSteps = (dayEndMin - dayStartMin) / 15; // e.g. 900/15 = 60
  const maxQuarterSteps = totalQuarterSteps - 1;
  if (quarterSteps > maxQuarterSteps) quarterSteps = maxQuarterSteps;

  const newStartMin = dayStartMin + quarterSteps * 15;

  const oldStartMin = timeToMinutes(booking.startTime);
  const oldEndMin = timeToMinutes(booking.endTime);
  const duration = oldEndMin - oldStartMin;

  let newEndMin = newStartMin + duration;
  if (newEndMin > dayEndMin) newEndMin = dayEndMin;

  const newStartTime = minutesToTime(newStartMin);
  const newEndTime = minutesToTime(newEndMin);

  const changed =
    booking.date !== newDate ||
    booking.startTime !== newStartTime ||
    booking.endTime !== newEndTime;

  if (!changed) return;

  try {
    await updateBooking(id, {
      date: newDate,
      startTime: newStartTime,
      endTime: newEndTime
    });
    await refreshBookings();
  } catch (err) {
    alert("Could not move booking (conflict).");
  }
}

// --- Firestore helpers ---

async function updateBooking(id, fields) {
  // id is Firestore doc id (string)
  const existing = bookings.find((b) => String(b.id) === String(id));
  if (!existing) throw new Error("Booking not found");

  const payload = {
    roomId: fields.roomId !== undefined ? fields.roomId : existing.roomId,
    date: fields.date || existing.date,
    meetingType: fields.meetingType || existing.meetingType,
    jobName: fields.jobName || existing.jobName,
    booker:
      fields.booker !== undefined ? fields.booker : (existing.booker || ""),
    peopleCount:
      fields.peopleCount !== undefined ? fields.peopleCount : existing.peopleCount,
    startTime: fields.startTime || existing.startTime,
    endTime: fields.endTime || existing.endTime
  };

  const bookingRef = doc(db, "bookings", String(id));
  await updateDoc(bookingRef, payload);

  return { id: String(id), ...payload };
}

async function deleteBooking(id) {
  await deleteDoc(doc(db, "bookings", String(id)));
  await refreshBookings();
}

// --- Modal & form ---

function openModalForNewBooking() {
  editingBookingId = null;
  modalTitle.textContent = "New Booking";
  deleteBtn.classList.add("hidden");
  formError.textContent = "";
  bookingForm.reset();

  if (weekDates.length) {
    bookingDateInput.value = weekDates[0];
  } else if (datePicker.value) {
    bookingDateInput.value = datePicker.value;
  }

  if (selectedRoomId) {
    roomSelect.value = String(selectedRoomId);
  }

  bookingModal.classList.remove("hidden");
}

function openModalForEdit(booking) {
  editingBookingId = String(booking.id);
  modalTitle.textContent = "Edit Booking";
  deleteBtn.classList.remove("hidden");
  formError.textContent = "";

  roomSelect.value = String(booking.roomId);
  meetingTypeSelect.value = booking.meetingType;
  peopleCountInput.value =
    booking.peopleCount && String(booking.peopleCount).trim() !== ""
      ? String(booking.peopleCount)
      : "";
  jobNameInput.value = booking.jobName;
  bookingDateInput.value = booking.date;
  startTimeInput.value = booking.startTime;
  endTimeInput.value = booking.endTime;
  bookerInput.value = booking.booker || "";

  bookingModal.classList.remove("hidden");
}

function closeModal() {
  bookingModal.classList.add("hidden");
}

async function handleFormSubmit(e) {
  e.preventDefault();
  formError.textContent = "";

  const formData = new FormData(bookingForm);

  const payload = {
    roomId: Number(formData.get("roomId")),
    date: formData.get("date"),
    meetingType: formData.get("meetingType"),
    jobName: formData.get("jobName").trim(),
    booker: (formData.get("booker") || "").trim(),
    peopleCount: formData.get("peopleCount") || "",
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime")
  };

  if (!payload.date) {
    formError.textContent = "Please choose a date.";
    return;
  }

  // 24h HH:MM validation with 15-minute steps
  const timePattern = /^([01]\d|2[0-3]):(00|15|30|45)$/;
  if (
    !timePattern.test(payload.startTime) ||
    !timePattern.test(payload.endTime)
  ) {
    formError.textContent =
      "Time must be HH:MM in 15-min steps (00, 15, 30, 45).";
    return;
  }

  const startMin = timeToMinutes(payload.startTime);
  const endMin = timeToMinutes(payload.endTime);
  const dayStartMin = START_HOUR * 60;
  const dayEndMin = END_HOUR * 60;

  if (startMin < dayStartMin || endMin > dayEndMin) {
    formError.textContent = "Time must be between 07:00 and 22:00.";
    return;
  }

  if (endMin <= startMin) {
    formError.textContent = "End time must be after start time.";
    return;
  }

  try {
    if (editingBookingId) {
      await updateBooking(editingBookingId, payload);
    } else {
      await addDoc(bookingsCol, payload);
    }

    closeModal();
    await refreshBookings();
  } catch (err) {
    formError.textContent = err.message || "Failed to save booking.";
  }
}

// --- Utilities ---

function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function toISODate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatFullDate(d) {
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}
