import { config } from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import Calendar from 'telegram-inline-calendar';
import * as chrono from 'chrono-node/ru';
import * as db from './db/reminder-db.js';
import fetch from 'node-fetch';
import { DateTime } from 'luxon';

config();

const token = process.env.TELEGRAM_BOT_TOKEN
const geoName = process.env.GEONAMES_USERNAME
const bot = new TelegramBot(token, {polling: true});
const calendar = new Calendar(bot, {
    date_format: 'DD-MM-YYYY',
    language: 'ru'
});


const userStates = new Map();

const scheduleReminder = (reminder) => {
    console.log(reminder);
    const delay = reminder.remind_at - Date.now();
    console.log(delay);
    if (delay > 0) {
        setTimeout(() => {
            bot.sendMessage(reminder.chat_id, `🔔 Напоминаю: ${reminder.task}`);
            db.deleteReminder(reminder.id);
        }, delay);
    } else {
        db.deleteReminder(reminder.id);
    }
};

for (const reminder of db.getReminders()) {
    scheduleReminder(reminder);
}

bot.onText(/\/старт|\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, '👋 Привет! Чем помочь?', mainMenu());
});

bot.onText(/\/напомни (.+)/i, (msg, match) => {
    console.log(typeof match);
    return handleSetReminder(msg, match)
});

bot.onText(/\/список/, (msg) => {
    handleReminderList(msg.chat.id);
});

bot.onText(/\/отмена (\d+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const id = parseInt(match[1]);

    const reminders = db.getUserReminders(chatId);
    const existingReminder = reminders.find(r => r.id === id);

    if (!existingReminder) {
        return bot.sendMessage(chatId, 'Напоминание с таким ID не найдено.');
    }

    db.deleteReminder(id);
    bot.sendMessage(chatId, `Забыли про ${existingReminder.text}`);
});

bot.onText(/\/помощь/, (msg) => {
    handleShowCommands(msg.chat.id)
});

bot.on("callback_query", (query) => {
    const userId = query.from.id;

    if (query.message.message_id == calendar.chats.get(query.message.chat.id)) {
        let res = calendar.clickButtonCalendar(query);
        if (res !== -1) {
            userStates.set(userId, { date: res, step: 0, answers: [] });
            bot.sendMessage(query.message.chat.id, "В какое время напомнить? Пример: 21:00");
        }
    }
});

bot.on('message', async (msg) => {
    const text = msg.text;
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const state = userStates.get(userId);

    if (msg.location) {
        const { latitude, longitude } = msg.location;
        const timezone = await getTimezoneFromCoords(latitude, longitude);

        if (timezone) {
            const currentState = userStates.get(userId) || {};
            userStates.set(userId, { ...currentState, timezone });
            bot.sendMessage(chatId, `✅ Часовой пояс установлен: ${timezone}`);
        } else {
            bot.sendMessage(chatId, `⚠️ Не удалось определить часовой пояс.`);
        }

        return;
    }

    if (text === '📋 Список') {
        return handleReminderList(msg.chat.id);
    } else if (text === '📖 Команды') {
        return handleShowCommands(msg.chat.id);
    } else if (text === '📅 Запланировать') {
        return handleCalendarSchedule(msg);
    }

    if (!state) return;

    const { step, answers, date, timezone } = state;

    answers[step] = msg.text;

    if (step === 0) {
        bot.sendMessage(chatId, 'О чем нужно напомнить?');
        userStates.set(userId, { date, step: 1, answers });
    } else if (step === 1) {
        const [time, text] = answers;

        handleSetReminder(msg, ['', `${date} ${time} ${text}`]);
        userStates.set(userId, { date: '', step: -1, answers: [], timezone });
    }
});

function mainMenu() {
    return {
        reply_markup: {
            keyboard: [
                [
                    {text: '📅 Запланировать', callback_query: 'schedule'},
                    {text: '📋 Список', callback_query: 'list'},
                    {text: '📖 Команды', callback_query: 'help'},
                ],
                [
                    {text: '📍 Отправить геопозицию', request_location: true}
                ]
            ],
            resize_keyboard: true,
        }
    }
}

function handleReminderList(chatId) {
    const reminders = db.getReminders(chatId);

    if (reminders.length === 0) {
        return bot.sendMessage(chatId, '🕳 Нет активных напоминаний');
    }

    const list = reminders.map(r => `🕑 id: ${r.id} ${new Date(r.remind_at).toLocaleString()} — ${r.task}`).join('\n');

    bot.sendMessage(chatId, `📋 Ваши напоминания:\n\n${list}`);
}

function handleShowCommands(chatId) {
    return bot.sendMessage(
        chatId,
        'Список команд: \n' +
        '\n' +
        '- /напомни {текст напоминания с датой} - создать новое напоминание, например "/напомни завтра в 10 утра купить кофе" \n' +
        '\n' +
        '- /список - вывести список текущих сохраненных напоминаний \n' +
        '\n' +
        '- /отмена {id напоминания} - отменить напоминание по id, например "/отмена 4" \n'
    );
}

function handleCalendarSchedule(msg) {
    calendar.startNavCalendar(msg);
}

function handleSetReminder(msg, match) {
    const chatId = msg.chat.id;
    const text = match[1];

    const state = userStates.get(msg.from.id);
    const timezone = state?.timezone || 'UTC'; // по умолчанию — UTC

    const parsed = chrono.parse(text)[0];
    if (!parsed) {
        return bot.sendMessage(chatId, '⛔️ Не смог распознать дату. Примеры: "завтра в 10 утра", "25 августа в 18:00"');
    }

    const originalDate = parsed.date();

    // Преобразуем в нужную таймзону
    const time = DateTime.fromJSDate(originalDate, { zone: 'UTC' }).setZone(timezone);
    const remindAt = time.toMillis();

    const task = text.replace(parsed.text, '').trim();

    if (!remindAt || remindAt <= Date.now()) {
        return bot.sendMessage(chatId, '⛔️ Время указано некорректно или в прошлом.');
    }

    const id = db.addReminder(chatId, task, remindAt);
    bot.sendMessage(chatId, `✅ Запомнил. ID: ${id}, задача: "${task}" в ${time.setZone(timezone).toFormat('dd.MM.yyyy HH:mm')} (${timezone})`);
    scheduleReminder({ id, chat_id: chatId, task, remind_at: remindAt });
}

async function getTimezoneFromCoords(lat, lon) {
    const url = `http://api.geonames.org/timezoneJSON?lat=${lat}&lng=${lon}&username=${geoName}`;

    try {
        const res = await fetch(url);
        const data = await res.json();

        if (data.timezoneId) {
            return data.timezoneId;
        } else {
            throw new Error('Не удалось определить таймзону');
        }
    } catch (err) {
        console.error(err);
        return null;
    }
}
