import Database from 'better-sqlite3';
const db = new Database('reminders.db');

// Инициализация таблицы
db.exec(`
  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER,
    task TEXT,
    remind_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS users (
    chat_id INTEGER PRIMARY KEY,
    timezone TEXT
  );
`);

// Добавление напоминания
export function addReminder(chatId, task, remindAt) {
  const stmt = db.prepare('INSERT INTO reminders (chat_id, task, remind_at) VALUES (?, ?, ?)');
  const info = stmt.run(chatId, task, remindAt);
  return info.lastInsertRowid;
}

// Получение всех активных
export function getReminders() {
  return db.prepare('SELECT * FROM reminders').all();
}

// Получение по chatId
export function getUserReminders(chatId) {
  return db.prepare('SELECT * FROM reminders WHERE chat_id = ?').all(chatId);
}

// Удаление по id
export function deleteReminder(id) {
  db.prepare('DELETE FROM reminders WHERE id = ?').run(id);
}

// Добавление часового пояса
export function setUserTimezone(chatId, timezone) {
  const stmt = db.prepare('INSERT INTO users (chat_id, timezone) VALUES (?, ?) ON CONFLICT(chat_id) DO UPDATE SET timezone = ?');
  stmt.run(chatId, timezone, timezone);
}

// Получение часового пояса
export function getUserTimezone(chatId) {
  const stmt = db.prepare('SELECT timezone FROM users WHERE chat_id = ?');
  const row = stmt.get(chatId);
  return row?.timezone || null;
}
