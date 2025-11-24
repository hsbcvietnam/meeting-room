const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
// Use 4000 so it won't conflict with your macros tracker on 3000
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const DATA_FILE = path.join(__dirname, "bookings.json");

// --- Rooms config ---
const ROOMS = [
  { id: 1, name: "Labrador", hasTv: true },
  { id: 2, name: "Border Collie", hasTv: true },
  { id: 3, name: "Rottweiler", hasTv: true },
  { id: 4, name: "Shiba", hasTv: false },
  { id: 5, name: "Poodle", hasTv: false }
];

// --- Helpers to load/save bookings ---
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ lastId: 0, bookings: [] }, null, 2)
    );
  }
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  return JSON.parse(raw);
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function isOverlapping(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// --- API routes ---

// Get rooms
app.get("/api/rooms", (req, res) => {
  res.json(ROOMS);
});

// Get bookings
// - /api/bookings?date=YYYY-MM-DD           -> single day
// - /api/bookings?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD -> range (inclusive)
app.get("/api/bookings", (req, res) => {
  const { date, startDate, endDate } = req.query;
  const data = loadData();
  let bookings = data.bookings;

  if (startDate && endDate) {
    bookings = bookings.filter(
      (b) => b.date >= startDate && b.date <= endDate
    );
  } else if (date) {
    bookings = bookings.filter((b) => b.date === date);
  }

  res.json(bookings);
});

// Create a booking
app.post("/api/bookings", (req, res) => {
  const {
    roomId,
    date,
    startTime,
    endTime,
    meetingType,
    jobName,
    peopleCount,
    booker
  } = req.body;

  if (!roomId || !date || !startTime || !endTime || !meetingType || !jobName) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  const room = ROOMS.find((r) => r.id === Number(roomId));
  if (!room) {
    return res.status(400).json({ error: "Invalid room." });
  }

  const data = loadData();

  const newStart = timeToMinutes(startTime);
  const newEnd = timeToMinutes(endTime);
  if (newEnd <= newStart) {
    return res.status(400).json({ error: "End time must be after start time." });
  }

  // Check for overlaps in the same room and date
  const conflict = data.bookings.find(
    (b) =>
      b.roomId === Number(roomId) &&
      b.date === date &&
      isOverlapping(
        newStart,
        newEnd,
        timeToMinutes(b.startTime),
        timeToMinutes(b.endTime)
      )
  );

  if (conflict) {
    return res.status(409).json({
      error: `This room is already booked from ${conflict.startTime} to ${conflict.endTime}.`
    });
  }

  const nextId = data.lastId + 1;
  const booking = {
    id: nextId,
    roomId: Number(roomId),
    roomName: room.name,
    date,
    startTime,
    endTime,
    meetingType,
    jobName,
    booker: booker ? String(booker) : "",
    peopleCount: peopleCount ? Number(peopleCount) : null
  };
  data.lastId = nextId;
  data.bookings.push(booking);
  saveData(data);
  res.status(201).json(booking);
});

// Update (edit / drag) a booking
app.put("/api/bookings/:id", (req, res) => {
  const id = Number(req.params.id);
  const data = loadData();
  const idx = data.bookings.findIndex((b) => b.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Booking not found." });
  }

  const existing = data.bookings[idx];

    const roomId = req.body.roomId !== undefined
    ? Number(req.body.roomId)
    : existing.roomId;
  const date = req.body.date || existing.date;
  const startTime = req.body.startTime || existing.startTime;
  const endTime = req.body.endTime || existing.endTime;
  const meetingType = req.body.meetingType || existing.meetingType;
  const jobName = req.body.jobName || existing.jobName;
  const booker =
    req.body.booker !== undefined ? req.body.booker : (existing.booker || "");
  const peopleCount =
    req.body.peopleCount !== undefined
      ? (req.body.peopleCount === null || req.body.peopleCount === ""
          ? null
          : Number(req.body.peopleCount))
      : existing.peopleCount;

  const room = ROOMS.find((r) => r.id === roomId);
  if (!room) {
    return res.status(400).json({ error: "Invalid room." });
  }

  const newStart = timeToMinutes(startTime);
  const newEnd = timeToMinutes(endTime);
  if (newEnd <= newStart) {
    return res.status(400).json({ error: "End time must be after start time." });
  }

  // Check for overlaps...
  const conflict = data.bookings.find(
    (b) =>
      b.id !== id &&
      b.roomId === roomId &&
      b.date === date &&
      isOverlapping(
        newStart,
        newEnd,
        timeToMinutes(b.startTime),
        timeToMinutes(b.endTime)
      )
  );

  if (conflict) {
    return res.status(409).json({
      error: `This room is already booked from ${conflict.startTime} to ${conflict.endTime}.`
    });
  }

  const updated = {
    ...existing,
    roomId,
    roomName: room.name,
    date,
    startTime,
    endTime,
    meetingType,
    jobName,
    booker,
    peopleCount
  };

  data.bookings[idx] = updated;
  saveData(data);
  res.json(updated);
});

// Delete (release) a booking
app.delete("/api/bookings/:id", (req, res) => {
  const id = Number(req.params.id);
  const data = loadData();
  const idx = data.bookings.findIndex((b) => b.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Booking not found." });
  }
  data.bookings.splice(idx, 1);
  saveData(data);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});