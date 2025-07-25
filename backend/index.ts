import { Hono } from "https://esm.sh/hono@3.11.7";
import { readFile, serveFile } from "https://esm.town/v/std/utils@85-main/index.ts";
import { sqlite } from "https://esm.town/v/stevekrouse/sqlite";
import { getCookie, setCookie } from "https://esm.sh/hono@3.11.7/cookie";
import { 
  createSession, 
  setSessionCookie, 
  clearSessionCookie,
  authMiddleware,
  verifyEventAccess,
  csrfMiddleware
} from "./auth.ts";
import { initDatabase, TABLES } from "./database.ts";

const app = new Hono();

// Unwrap Hono errors to see original error details
app.onError((err, c) => {
  throw err;
});

// Database table names imported from centralized schema

// Initialize database on startup
await initDatabase();
console.log(`🚀 [System] Event check-in system ready!`);

// Serve static files
app.get("/frontend/*", c => serveFile(c.req.path, import.meta.url));
app.get("/shared/*", c => serveFile(c.req.path, import.meta.url));

// Serve main page
app.get("/", async c => {
  const html = await readFile("/frontend/index.html", import.meta.url);
  return c.html(html);
});

// Route handlers for different pages
app.get("/new", async c => {
  const html = await readFile("/frontend/index.html", import.meta.url);
  return c.html(html);
});

app.get("/:eventId/signin", async c => {
  const html = await readFile("/frontend/index.html", import.meta.url);
  return c.html(html);
});

app.get("/:eventId/manage", async c => {
  const html = await readFile("/frontend/index.html", import.meta.url);
  return c.html(html);
});

app.get("/:eventId", async c => {
  const html = await readFile("/frontend/index.html", import.meta.url);
  return c.html(html);
});

app.get("/events/:eventId/add-attendee", async c => {
  const html = await readFile("/frontend/index.html", import.meta.url);
  return c.html(html);
});

// Utility functions
function hashPassword(password: string): string {
  // Simple hash for demo - in production, use proper bcrypt or similar
  return btoa(password + "salt").replace(/[^a-zA-Z0-9]/g, '');
}

function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

// CSV parsing utility with proper quoted field handling
function parseCSV(csvContent: string): { attendees: Array<{name: string, external_id?: string}>, errors: string[] } {
  const lines = csvContent.trim().split('\n');
  const errors: string[] = [];
  const attendees: Array<{name: string, external_id?: string}> = [];
  
  if (lines.length === 0) {
    errors.push("CSV file is empty");
    return { attendees, errors };
  }
  
  // Parse CSV row with proper quote handling
  function parseCSVRow(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    let i = 0;
    
    while (i < line.length) {
      const char = line[i];
      
      if (char === '"' && !inQuotes) {
        inQuotes = true;
      } else if (char === '"' && inQuotes) {
        // Check for escaped quote
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // Skip the escaped quote
        } else {
          inQuotes = false;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
      i++;
    }
    
    result.push(current.trim());
    return result;
  }
  
  // Parse header row
  const headers = parseCSVRow(lines[0]).map(h => h.toLowerCase());
  console.log(`📋 [CSV] Found headers:`, headers);
  
  // Find name columns - flexible matching
  let nameIndex = -1;
  let firstNameIndex = -1;
  let lastNameIndex = -1;
  let idIndex = -1;
  let emailIndex = -1;
  
  headers.forEach((header, index) => {
    const cleanHeader = header.toLowerCase();
    if (cleanHeader === 'name' || (cleanHeader.includes('name') && !cleanHeader.includes('first') && !cleanHeader.includes('last') && !cleanHeader.includes('given') && !cleanHeader.includes('family'))) {
      nameIndex = index;
    } else if (cleanHeader.includes('first') || cleanHeader === 'first name') {
      firstNameIndex = index;
    } else if (cleanHeader.includes('last') || cleanHeader === 'last name' || cleanHeader.includes('family') || cleanHeader.includes('surname')) {
      lastNameIndex = index;
    } else if ((cleanHeader.includes('id') || cleanHeader === 'member id') && !cleanHeader.includes('email')) {
      idIndex = index;
    } else if (cleanHeader.includes('email') || cleanHeader === 'email') {
      emailIndex = index;
    }
  });
  
  console.log(`📋 [CSV] Column mapping - name: ${nameIndex}, firstName: ${firstNameIndex}, lastName: ${lastNameIndex}, id: ${idIndex}, email: ${emailIndex}`);
  
  // Process data rows
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i]);
    
    if (row.length !== headers.length) {
      errors.push(`Row ${i + 1}: Column count mismatch (expected ${headers.length}, got ${row.length})`);
      continue;
    }
    
    let name = '';
    
    // Extract name using flexible logic
    if (nameIndex >= 0 && row[nameIndex]) {
      name = row[nameIndex];
    } else if (firstNameIndex >= 0 && lastNameIndex >= 0) {
      const firstName = row[firstNameIndex] || '';
      const lastName = row[lastNameIndex] || '';
      name = `${firstName} ${lastName}`.trim();
    } else if (firstNameIndex >= 0) {
      name = row[firstNameIndex];
    }
    
    if (!name) {
      errors.push(`Row ${i + 1}: No name found`);
      continue;
    }
    
    const attendee: {name: string, external_id?: string} = { name };
    
    if (idIndex >= 0 && row[idIndex]) {
      attendee.external_id = row[idIndex];
    }
    
    attendees.push(attendee);
  }
  
  console.log(`📋 [CSV] Parsed ${attendees.length} attendees with ${errors.length} errors`);
  return { attendees, errors };
}

// API Routes

// Create new event
app.post("/api/events", async c => {
  console.log(`🎯 [API] New event creation request`);
  
  try {
    const body = await c.req.json();
    const { name, password, location, csvContent } = body;
    
    console.log(`📋 [API] Event details: "${name}", location: "${location || 'N/A'}"`);
    
    if (!name || !password || !csvContent) {
      return c.json({ error: "Missing required fields: name, password, csvContent" }, 400);
    }
    
    // Parse CSV
    const { attendees, errors } = parseCSV(csvContent);
    
    if (attendees.length === 0) {
      return c.json({ error: "No valid attendees found in CSV", csvErrors: errors }, 400);
    }
    
    // Create event with unix timestamp as ID
    const passwordHash = hashPassword(password);
    const eventId = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
    console.log(`📋 [API] Creating event with ID: ${eventId}, name: "${name}", location: "${location || 'N/A'}"`);

    try {
      await sqlite.execute(
        `INSERT INTO ${TABLES.EVENTS} (id, name, password_hash, location) VALUES (?, ?, ?, ?)`,
        [eventId, name, passwordHash, location || null]
      );
      console.log(`✅ [API] Event successfully inserted into database with ID: ${eventId}`);
    } catch (error) {
      console.error(`💥 [API] Failed to insert event:`, error);
      throw error;
    }

    // Verify event was created
    const verifyEventResult = await sqlite.execute(`SELECT id, name FROM ${TABLES.EVENTS} WHERE id = ?`, [eventId]);
    const verifyEvent = verifyEventResult.rows || verifyEventResult;
    console.log(`🔍 [API] Event verification: found ${verifyEvent.length} events with ID ${eventId}`);
    if (verifyEvent.length > 0) {
      console.log(`🔍 [API] Event details: ${JSON.stringify(verifyEvent[0])}`);
    }

    // Insert attendees
    console.log(`📋 [API] Starting to insert ${attendees.length} attendees...`);
    let insertedCount = 0;
    for (const attendee of attendees) {
      try {
        await sqlite.execute(
          `INSERT INTO ${TABLES.ATTENDEES} (event_id, name, external_id) VALUES (?, ?, ?)`,
          [eventId, attendee.name, attendee.external_id || null]
        );
        insertedCount++;
        console.log(`👤 [API] Inserted attendee ${insertedCount}/${attendees.length}: "${attendee.name}" (external_id: ${attendee.external_id || 'N/A'})`);
      } catch (error) {
        console.error(`💥 [API] Failed to insert attendee "${attendee.name}":`, error);
        throw error;
      }
    }

    // Verify attendees were inserted
    const verifyAttendeesResult = await sqlite.execute(`SELECT COUNT(*) as count FROM ${TABLES.ATTENDEES} WHERE event_id = ?`, [eventId]);
    const verifyAttendees = verifyAttendeesResult.rows || verifyAttendeesResult;
    const actualAttendeeCount = Number(verifyAttendees[0]?.count || 0);
    console.log(`🔍 [API] Attendee verification: expected ${attendees.length}, found ${actualAttendeeCount} in database`);

    console.log(`✅ [API] Successfully added ${insertedCount} attendees to event ${eventId}`);
    
    return c.json({
      success: true,
      eventId,
      attendeeCount: attendees.length,
      csvErrors: errors
    });
    
  } catch (error) {
    console.error(`💥 [API] Error creating event:`, error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Get basic event info (public, no auth required)
app.get("/api/:eventId", async c => {
  const eventId = parseInt(c.req.param("eventId"));
  console.log(`📋 [API] Fetching basic event details for event ${eventId}`);
  
  try {
    const eventResult = await sqlite.execute(`
      SELECT id, name, location, created_at FROM ${TABLES.EVENTS} WHERE id = ?
    `, [eventId]);
    
    const event = eventResult.rows || eventResult;
    
    if (event.length === 0) {
      console.log(`❌ [API] Event ${eventId} not found`);
      return c.json({ error: "Event not found" }, 404);
    }
    
    // Get attendee counts
    const attendeeCountResult = await sqlite.execute(`
      SELECT COUNT(*) as count FROM ${TABLES.ATTENDEES} WHERE event_id = ?
    `, [eventId]);
    
    const checkedInCountResult = await sqlite.execute(`
      SELECT COUNT(*) as count FROM ${TABLES.CHECKINS} WHERE attendee_id IN (
        SELECT id FROM ${TABLES.ATTENDEES} WHERE event_id = ?
      )
    `, [eventId]);
    
    const attendeeCountRows = attendeeCountResult.rows || attendeeCountResult;
    const checkedInCountRows = checkedInCountResult.rows || checkedInCountResult;
    const attendeeCount = Number(attendeeCountRows[0]?.count || 0);
    const checkedInCount = Number(checkedInCountRows[0]?.count || 0);
    
    console.log(`📋 [API] Event ${eventId} found: ${attendeeCount} attendees, ${checkedInCount} checked in`);
    
    return c.json({
      event: {
        id: event[0].id,
        name: event[0].name,
        location: event[0].location,
        created_at: event[0].created_at
      },
      attendeeCount,
      checkedInCount
    });
    
  } catch (error) {
    console.error(`💥 [API] Error fetching event details:`, error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Get attendee list for sign-in (names only, no sensitive info)
app.get("/api/:eventId/attendees", async c => {
  const eventId = parseInt(c.req.param("eventId"));
  console.log(`📋 [API] Fetching attendees for event ${eventId}`);
  
  try {
    // First check if event exists
    console.log(`🔍 [API] Checking if event ${eventId} exists in table ${TABLES.EVENTS}`);
    const eventCheckResult = await sqlite.execute(`
      SELECT id FROM ${TABLES.EVENTS} WHERE id = ?
    `, [eventId]);
    
    const eventCheck = eventCheckResult.rows || eventCheckResult;
    console.log(`🔍 [API] Event check result: found ${eventCheck.length} events with ID ${eventId}`);
    if (eventCheck.length === 0) {
      console.log(`❌ [API] Event ${eventId} not found`);
      return c.json({ error: "Event not found" }, 404);
    }
    
    // Get attendees with check-in status
    console.log(`🔍 [API] Querying attendees from table ${TABLES.ATTENDEES} for event ${eventId}`);
    const attendeesResult = await sqlite.execute(`
      SELECT a.id, a.name, 
             CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END as checked_in
      FROM ${TABLES.ATTENDEES} a
      LEFT JOIN ${TABLES.CHECKINS} c ON a.id = c.attendee_id
      WHERE a.event_id = ?
      ORDER BY a.name
    `, [eventId]);
    
    const attendees = attendeesResult.rows || attendeesResult;
    console.log(`📋 [API] Found ${attendees.length} attendees for event ${eventId}`);
    
    // Log first few attendees for debugging
    if (attendees.length > 0) {
      console.log(`🔍 [API] First few attendees:`, attendees.slice(0, 3).map(a => ({ id: a.id, name: a.name, checked_in: a.checked_in })));
    }
    
    const result = {
      attendees: attendees.map(row => ({
        id: row.id,
        name: row.name,
        checkedIn: Boolean(row.checked_in)
      }))
    };
    
    console.log(`📋 [API] Returning ${result.attendees.length} attendees to client`);
    return c.json(result);
    
  } catch (error) {
    console.error(`💥 [API] Error fetching attendees for event ${eventId}:`, error);
    console.error(`💥 [API] Error stack:`, error.stack);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Sign in to event
app.post("/api/:eventId/signin", async c => {
  const eventId = parseInt(c.req.param("eventId"));
  
  try {
    const body = await c.req.json();
    const { attendeeId } = body;
    
    if (!attendeeId) {
      return c.json({ error: "Attendee ID required" }, 400);
    }
    
    // Verify attendee belongs to this event
    const attendeeResult = await sqlite.execute(
      `SELECT * FROM ${TABLES.ATTENDEES} WHERE id = ? AND event_id = ?`,
      [attendeeId, eventId]
    );
    
    const attendee = attendeeResult.rows || attendeeResult;
    if (attendee.length === 0) {
      return c.json({ error: "Attendee not found for this event" }, 404);
    }
    
    // Check if already signed in
    const existingCheckInResult = await sqlite.execute(
      `SELECT * FROM ${TABLES.CHECKINS} WHERE event_id = ? AND attendee_id = ?`,
      [eventId, attendeeId]
    );
    
    const existingCheckIn = existingCheckInResult.rows || existingCheckInResult;
    if (existingCheckIn.length > 0) {
      console.log(`⚠️ [API] Attendee ${attendee[0].name} already signed in`);
      // TODO: Consider security implications of multiple sign-in attempts
      // For now, we'll allow it but flag it
      return c.json({
        success: true,
        attendeeName: attendee[0].name,
        alreadySignedIn: true,
        message: "You were already signed in, but we've recorded this additional check-in."
      });
    }
    
    // Record check-in
    await sqlite.execute(
      `INSERT INTO ${TABLES.CHECKINS} (event_id, attendee_id) VALUES (?, ?)`,
      [eventId, attendeeId]
    );
    
    console.log(`✅ [API] ${attendee[0].name} signed in to event ${eventId}`);
    
    return c.json({
      success: true,
      attendeeName: attendee[0].name,
      alreadySignedIn: false
    });
    
  } catch (error) {
    console.error(`💥 [API] Error during sign-in:`, error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Authentication endpoint - login with password and create session
app.post("/api/:eventId/auth", async c => {
  const eventId = parseInt(c.req.param("eventId"));
  
  try {
    const body = await c.req.json();
    const { password } = body;
    
    if (!password) {
      return c.json({ error: "Password required" }, 401);
    }
    
    // Get event
    const eventsResult = await sqlite.execute(
      `SELECT * FROM ${TABLES.EVENTS} WHERE id = ?`,
      [eventId]
    );
    
    const events = eventsResult.rows || eventsResult;
    if (events.length === 0) {
      return c.json({ error: "Event not found" }, 404);
    }
    
    const event = events[0];
    
    // Verify password
    if (!verifyPassword(password, event.password_hash)) {
      return c.json({ error: "Invalid password" }, 401);
    }
    
    // Create session
    const session = await createSession(eventId);
    setSessionCookie(c, session.token);
    
    return c.json({ success: true });
    
  } catch (error) {
    console.error(`💥 [API] Error during authentication:`, error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Logout endpoint
app.post("/api/:eventId/logout", async c => {
  clearSessionCookie(c);
  return c.json({ success: true });
});

// Get event details (session protected)
app.get("/api/:eventId/details", authMiddleware, async c => {
  const eventId = parseInt(c.req.param("eventId"));
  
  try {
    // Verify access to this specific event
    if (!await verifyEventAccess(c, eventId)) {
      return c.json({ error: "Unauthorized for this event" }, 403);
    }
    
    // Get event
    const eventsResult = await sqlite.execute(
      `SELECT * FROM ${TABLES.EVENTS} WHERE id = ?`,
      [eventId]
    );
    
    const events = eventsResult.rows || eventsResult;
    if (events.length === 0) {
      return c.json({ error: "Event not found" }, 404);
    }
    
    const event = events[0];
    
    // Get counts
    const attendeeCountResult = await sqlite.execute(
      `SELECT COUNT(*) as count FROM ${TABLES.ATTENDEES} WHERE event_id = ?`,
      [eventId]
    );
    
    const checkedInCountResult = await sqlite.execute(
      `SELECT COUNT(*) as count FROM ${TABLES.CHECKINS} WHERE event_id = ?`,
      [eventId]
    );
    
    const attendeeCountRows = attendeeCountResult.rows || attendeeCountResult;
    const checkedInCountRows = checkedInCountResult.rows || checkedInCountResult;
    
    return c.json({
      event: {
        id: event.id,
        name: event.name,
        location: event.location,
        created_at: event.created_at
      },
      attendeeCount: attendeeCountRows[0].count,
      checkedInCount: checkedInCountRows[0].count
    });
    
  } catch (error) {
    console.error(`💥 [API] Error fetching event details:`, error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Get analytics (session protected)
app.get("/api/:eventId/analytics", authMiddleware, async c => {
  const eventId = parseInt(c.req.param("eventId"));
  
  try {
    // Verify access to this specific event
    if (!await verifyEventAccess(c, eventId)) {
      return c.json({ error: "Unauthorized for this event" }, 403);
    }
    
    // Get total counts
    const totalAttendees = await sqlite.execute(
      `SELECT COUNT(*) as count FROM ${TABLES.ATTENDEES} WHERE event_id = ?`,
      [eventId]
    );
    
    const totalCheckedIn = await sqlite.execute(
      `SELECT COUNT(*) as count FROM ${TABLES.CHECKINS} WHERE event_id = ?`,
      [eventId]
    );
    
    // Get check-ins by date
    const checkInsByDate = await sqlite.execute(`
      SELECT DATE(checked_in_at) as date, COUNT(*) as count
      FROM ${TABLES.CHECKINS}
      WHERE event_id = ?
      GROUP BY DATE(checked_in_at)
      ORDER BY date
    `, [eventId]);
    
    // Get recent check-ins
    const recentCheckIns = await sqlite.execute(`
      SELECT a.name as attendee_name, c.checked_in_at
      FROM ${TABLES.CHECKINS} c
      JOIN ${TABLES.ATTENDEES} a ON c.attendee_id = a.id
      WHERE c.event_id = ?
      ORDER BY c.checked_in_at DESC
      LIMIT 10
    `, [eventId]);
    
    return c.json({
      totalAttendees: totalAttendees[0].count,
      totalCheckedIn: totalCheckedIn[0].count,
      checkInsByDate: checkInsByDate.map(row => ({
        date: row.date,
        count: row.count
      })),
      recentCheckIns: recentCheckIns.map(row => ({
        attendeeName: row.attendee_name,
        checkedInAt: row.checked_in_at
      }))
    });
    
  } catch (error) {
    console.error(`💥 [API] Error fetching analytics:`, error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Export check-in data as CSV (session protected)
app.get("/api/:eventId/export", authMiddleware, async c => {
  const eventId = parseInt(c.req.param("eventId"));
  
  try {
    // Verify access to this specific event
    if (!await verifyEventAccess(c, eventId)) {
      return c.json({ error: "Unauthorized for this event" }, 403);
    }
    
    // Get event name
    const eventsResult = await sqlite.execute(
      `SELECT name FROM ${TABLES.EVENTS} WHERE id = ?`,
      [eventId]
    );
    
    const events = eventsResult.rows || eventsResult;
    if (events.length === 0) {
      return c.json({ error: "Event not found" }, 404);
    }
    
    // Get all attendees with check-in data
    const dataResult = await sqlite.execute(`
      SELECT a.name, a.external_id, c.checked_in_at
      FROM ${TABLES.ATTENDEES} a
      LEFT JOIN ${TABLES.CHECKINS} c ON a.id = c.attendee_id
      WHERE a.event_id = ?
      ORDER BY a.name
    `, [eventId]);
    
    const data = dataResult.rows || dataResult;
    
    // Generate CSV
    const csvRows = [
      'Name,External ID,Checked In,Check-in Time'
    ];
    
    for (const row of data) {
      const checkedIn = row.checked_in_at ? 'Yes' : 'No';
      const checkInTime = row.checked_in_at || '';
      csvRows.push(`"${row.name}","${row.external_id || ''}","${checkedIn}","${checkInTime}"`);
    }
    
    const csvContent = csvRows.join('\n');
    const filename = `${events[0].name.replace(/[^a-zA-Z0-9]/g, '_')}_checkins.csv`;
    
    return new Response(csvContent, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    });
    
  } catch (error) {
    console.error(`💥 [API] Error exporting data:`, error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Add individual attendee to event (password protected)
app.post("/api/events/:eventId/attendees", async c => {
  const eventId = parseInt(c.req.param("eventId"));
  
  try {
    const body = await c.req.json();
    const { password, name, external_id } = body;
    
    console.log(`🎯 [API] Add attendee request for event ${eventId}: ${name}`);
    
    if (!password) {
      return c.json({ error: "Password required" }, 401);
    }
    
    if (!name || !name.trim()) {
      return c.json({ error: "Attendee name required" }, 400);
    }
    
    // Verify event and password
    const events = await sqlite.execute(
      `SELECT password_hash FROM ${EVENTS_TABLE} WHERE id = ?`,
      [eventId]
    );
    
    if (events.length === 0) {
      return c.json({ error: "Event not found" }, 404);
    }
    
    if (!verifyPassword(password, events[0].password_hash)) {
      return c.json({ error: "Invalid password" }, 401);
    }
    
    // Check if attendee with same name already exists
    const existingAttendee = await sqlite.execute(
      `SELECT id FROM ${ATTENDEES_TABLE} WHERE event_id = ? AND LOWER(name) = LOWER(?)`,
      [eventId, name.trim()]
    );
    
    if (existingAttendee.length > 0) {
      return c.json({ error: "An attendee with this name already exists" }, 409);
    }
    
    // Add attendee
    const result = await sqlite.execute(
      `INSERT INTO ${ATTENDEES_TABLE} (event_id, name, external_id) VALUES (?, ?, ?)`,
      [eventId, name.trim(), external_id?.trim() || null]
    );
    
    const attendeeId = Number(result.lastInsertRowid);
    console.log(`✅ [API] Added attendee ${name} with ID: ${attendeeId}`);
    
    return c.json({
      success: true,
      attendee: {
        id: attendeeId,
        name: name.trim(),
        external_id: external_id?.trim() || null,
        event_id: eventId
      }
    });
    
  } catch (error) {
    console.error(`💥 [API] Error adding attendee:`, error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export default app.fetch;