import Database from 'better-sqlite3';
const db = new Database('reminders.db');

// Инициализация таблицы
db.prepare(`
  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER,
    task TEXT,
    remind_at INTEGER
)
`).run();

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
