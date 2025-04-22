require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const Calendar = require('telegram-inline-calendar');
const chrono = require('chrono-node/ru');
const db = require('./db/reminder-db');

const token = process.env.TELEGRAM_BOT_TOKEN
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

bot.on('message', (msg) => {
    const text = msg.text;
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const state = userStates.get(userId);

    if (text === '📋 Список') {
        return handleReminderList(msg.chat.id);
    } else if (text === '📖 Команды') {
        return handleShowCommands(msg.chat.id);
    } else if (text === '📅 Запланировать') {
        return handleCalendarSchedule(msg);
    }

    if (msg.location) {
        const { latitude, longitude } = msg.location;
        // дальше можно использовать API вроде timezonedb или Google TimeZone API
    }

    if (!state) return;

    const { step, answers, date } = state;

    answers[step] = msg.text;

    if (step === 0) {
        bot.sendMessage(chatId, 'О чем нужно напомнить?');
        userStates.set(userId, { date, step: 1, answers });
    } else if (step === 1) {
        const [time, text] = answers;

        handleSetReminder(msg, [`${date} ${time} ${text}`]);
        userStates.delete(userId);
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
                    {text: '📍 Отправить геопозицию', request_location: true}
                ],
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

    const parsed = chrono.parse(text)[0];
    console.log(chrono.parse(text))
    console.log(parsed)
    if (!parsed) {
        return bot.sendMessage(chatId, '⛔️ Не смог распознать дату. Примеры: "завтра в 10 утра", "10 апреля в 5 вечера"');
    }

    const time = parsed.date();
    const task = text.replace(parsed.text, '').trim();
    const remindAt = time?.getTime();

    if (!remindAt || remindAt <= Date.now()) {
        return bot.sendMessage(chatId, 'Не смог распознать корректное время. Пример: /напомни Купить хлеб через 15 минут');
    }

    const id = db.addReminder(chatId, task, remindAt);
    bot.sendMessage(chatId, `✅ Запомнил. ID: ${id}, задача: "${task}" в ${time.toLocaleString()}`);
    scheduleReminder({ id, chat_id: chatId, task, remind_at: remindAt });
}
