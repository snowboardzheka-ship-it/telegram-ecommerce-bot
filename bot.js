const { Telegraf } = require('telegraf');
const { Markup } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();

// Настройки бота - нужно заменить на реальные
const BOT_TOKEN = 'YOUR_BOT_TOKEN';

// Инициализация бота
const bot = new Telegraf(BOT_TOKEN);

// База данных
const db = new sqlite3.Database('./ecommerce.db');

// Создание таблиц
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        price INTEGER NOT NULL,
        category TEXT NOT NULL,
        image_url TEXT,
        stock INTEGER DEFAULT 0,
        in_stock BOOLEAN DEFAULT 1
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        total_amount INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        customer_name TEXT NOT NULL,
        customer_phone TEXT NOT NULL,
        customer_address TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        price INTEGER NOT NULL,
        FOREIGN KEY (order_id) REFERENCES orders (id),
        FOREIGN KEY (product_id) REFERENCES products (id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS cart (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products (id)
    )`);
});

// Добавление тестовых товаров
const insertProducts = () => {
    const products = [
        { name: 'Кофе Арабика', description: '100% арабика из Эфиопии', price: 890, category: 'Кофе', stock: 25 },
        { name: 'Чай Зеленый', description: 'Цейлонский зеленый чай', price: 350, category: 'Чай', stock: 50 },
        { name: 'Эспрессо-машина', description: 'Автоматическая кофемашина', price: 25000, category: 'Техника', stock: 3 },
        { name: 'Турка Медная', description: 'Традиционная медная турка', price: 1500, category: 'Посуда', stock: 15 },
        { name: 'Капсулы для кофе', description: 'Капсулы арабика 20 шт', price: 450, category: 'Кофе', stock: 100 }
    ];

    products.forEach(product => {
        db.run(
            'INSERT OR IGNORE INTO products (name, description, price, category, stock, in_stock) VALUES (?, ?, ?, ?, ?, ?)',
            [product.name, product.description, product.price, product.category, product.stock, product.stock > 0]
        );
    });
};

insertProducts();

// Функции для работы с БД
const getProducts = () => {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM products WHERE in_stock = 1', (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

const getCategories = () => {
    return new Promise((resolve, reject) => {
        db.all('SELECT DISTINCT category FROM products WHERE in_stock = 1', (err, rows) => {
            if (err) reject(err);
            else resolve(rows.map(row => row.category));
        });
    });
};

const getProductsByCategory = (category) => {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM products WHERE category = ? AND in_stock = 1', [category], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

const getProductById = (id) => {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM products WHERE id = ?', [id], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
};

const addToCart = (userId, productId, quantity = 1) => {
    return new Promise((resolve, reject) => {
        // Проверяем, есть ли уже такой товар в корзине
        db.get(
            'SELECT * FROM cart WHERE user_id = ? AND product_id = ?',
            [userId, productId],
            (err, row) => {
                if (err) reject(err);
                else if (row) {
                    // Увеличиваем количество
                    db.run(
                        'UPDATE cart SET quantity = quantity + ? WHERE id = ?',
                        [quantity, row.id],
                        function(err) {
                            if (err) reject(err);
                            else resolve(this.lastID);
                        }
                    );
                } else {
                    // Добавляем новый товар
                    db.run(
                        'INSERT INTO cart (user_id, product_id, quantity) VALUES (?, ?, ?)',
                        [userId, productId, quantity],
                        function(err) {
                            if (err) reject(err);
                            else resolve(this.lastID);
                        }
                    );
                }
            }
        );
    });
};

const getCartItems = (userId) => {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT c.*, p.name, p.price, p.stock 
             FROM cart c 
             JOIN products p ON c.product_id = p.id 
             WHERE c.user_id = ?`,
            [userId],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            }
        );
    });
};

const clearCart = (userId) => {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM cart WHERE user_id = ?', [userId], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
};

const createOrder = (userId, customerName, customerPhone, customerAddress) => {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT SUM(c.quantity * p.price) as total 
             FROM cart c 
             JOIN products p ON c.product_id = p.id 
             WHERE c.user_id = ?`,
            [userId],
            (err, cart) => {
                if (err) reject(err);
                else {
                    const totalAmount = cart.total || 0;
                    
                    db.run(
                        'INSERT INTO orders (user_id, total_amount, customer_name, customer_phone, customer_address) VALUES (?, ?, ?, ?, ?)',
                        [userId, totalAmount, customerName, customerPhone, customerAddress],
                        function(err) {
                            if (err) reject(err);
                            else resolve(this.lastID);
                        }
                    );
                }
            }
        );
    });
};

const addOrderItems = (orderId, userId) => {
    return new Promise((resolve, reject) => {
        db.all(
            'SELECT * FROM cart WHERE user_id = ?',
            [userId],
            (err, cartItems) => {
                if (err) reject(err);
                else {
                    const statements = cartItems.map(item => {
                        return new Promise((resolve, reject) => {
                            db.run(
                                'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)',
                                [orderId, item.product_id, item.quantity, item.stock * item.quantity],
                                (err) => {
                                    if (err) reject(err);
                                    else resolve();
                                }
                            );
                        });
                    });
                    
                    Promise.all(statements)
                        .then(resolve)
                        .catch(reject);
                }
            }
        );
    });
};

// Команды бота
bot.start(async (ctx) => {
    await ctx.reply(
        '🛒 Добро пожаловать в наш интернет-магазин!\n\nПопулярные категории, удобная корзина и быстрые заказы.',
        Markup.keyboard([
            ['📱 Каталог', '🛒 Корзина'],
            ['📊 Мои заказы', 'ℹ️ О магазине']
        ]).resize()
    );
});

bot.hears('📱 Каталог', async (ctx) => {
    try {
        const categories = await getCategories();
        const keyboard = categories.map(cat => [`${cat} (${categories.indexOf(cat) + 1})`]);
        keyboard.push(['🛒 Корзина', '🏠 Главное меню']);
        
        await ctx.reply(
            '📱 КАТЕГОРИИ ТОВАРОВ:\n\nВыберите категорию:',
            Markup.keyboard(keyboard).resize()
        );
    } catch (error) {
        await ctx.reply('❌ Ошибка при загрузке каталога');
    }
});

// Обработка выбора категории
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    
    if (text.includes('🏠 Главное меню')) {
        await ctx.reply(
            'Главное меню:',
            Markup.keyboard([
                ['📱 Каталог', '🛒 Корзина'],
                ['📊 Мои заказы', 'ℹ️ О магазине']
            ]).resize()
        );
        return;
    }
    
    // Проверяем, является ли текст номером категории
    const match = text.match(/(\d+)\)/);
    if (match) {
        try {
            const categoryIndex = parseInt(match[1]) - 1;
            const categories = await getCategories();
            
            if (categoryIndex >= 0 && categoryIndex < categories.length) {
                const selectedCategory = categories[categoryIndex];
                const products = await getProductsByCategory(selectedCategory);
                
                if (products.length === 0) {
                    await ctx.reply(`❌ В категории "${selectedCategory}" пока нет товаров`);
                    return;
                }
                
                const keyboard = products.map(product => [`${product.name} - ${product.price}₽`]);
                keyboard.push(['📱 Каталог', '🛒 Корзина']);
                
                let message = `📂 ${selectedCategory.toUpperCase()}\n\n`;
                products.forEach((product, index) => {
                    message += `${index + 1}. ${product.name}\n`;
                    message += `   💰 ${product.price}₽\n`;
                    message += `   📦 В наличии: ${product.stock} шт.\n\n`;
                });
                
                await ctx.reply(
                    message,
                    Markup.keyboard(keyboard).resize()
                );
            }
        } catch (error) {
            console.error('Error:', error);
        }
    }
});

// Обработка выбора товара
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const products = await getProducts();
    const selectedProduct = products.find(product => 
        text.includes(product.name) && text.includes(product.price.toString())
    );
    
    if (selectedProduct) {
        await ctx.reply(
            `📦 ${selectedProduct.name}\n\n` +
            `📝 ${selectedProduct.description}\n\n` +
            `💰 Цена: ${selectedProduct.price}₽\n` +
            `📦 В наличии: ${selectedProduct.stock} шт.\n\n` +
            `Добавить в корзину?`,
            Markup.keyboard([
                ['✅ Добавить в корзину'],
                ['📱 Каталог', '🛒 Корзина']
            ]).resize()
        );
        
        ctx.session = ctx.session || {};
        ctx.session.selectedProduct = selectedProduct;
    }
});

// Добавление в корзину
bot.hears('✅ Добавить в корзину', async (ctx) => {
    const product = ctx.session?.selectedProduct;
    
    if (!product) {
        await ctx.reply('❌ Товар не выбран');
        return;
    }
    
    try {
        await addToCart(ctx.from.id, product.id, 1);
        
        await ctx.reply(
            `✅ ${product.name} добавлен в корзину!\n\n` +
            `Продолжить покупки или оформить заказ?`,
            Markup.keyboard([
                ['📱 Каталог', '🛒 Корзина'],
                ['✅ Заказать']
            ]).resize()
        );
        
        ctx.session = {};
    } catch (error) {
        await ctx.reply('❌ Ошибка при добавлении в корзину');
    }
});

// Просмотр корзины
bot.hears('🛒 Корзина', async (ctx) => {
    try {
        const cartItems = await getCartItems(ctx.from.id);
        
        if (cartItems.length === 0) {
            await ctx.reply('🛒 Ваша корзина пуста\n\nДобавьте товары из каталога');
            return;
        }
        
        let message = '🛒 ВАША КОРЗИНА:\n\n';
        let total = 0;
        
        cartItems.forEach((item, index) => {
            const itemTotal = item.quantity * item.price;
            total += itemTotal;
            
            message += `${index + 1}. ${item.name}\n`;
            message += `   Количество: ${item.quantity} шт.\n`;
            message += `   Цена: ${item.price}₽ за шт.\n`;
            message += `   Итого: ${itemTotal}₽\n\n`;
        });
        
        message += `💰 ИТОГО: ${total}₽`;
        
        await ctx.reply(
            message,
            Markup.keyboard([
                ['✅ Заказать'],
                ['🗑️ Очистить корзину', '📱 Каталог']
            ]).resize()
        );
    } catch (error) {
        await ctx.reply('❌ Ошибка при загрузке корзины');
    }
});

// Очистка корзины
bot.hears('🗑️ Очистить корзину', async (ctx) => {
    try {
        await clearCart(ctx.from.id);
        await ctx.reply('🗑️ Корзина очищена');
    } catch (error) {
        await ctx.reply('❌ Ошибка при очистке корзины');
    }
});

// Оформление заказа
bot.hears('✅ Заказать', async (ctx) => {
    try {
        const cartItems = await getCartItems(ctx.from.id);
        
        if (cartItems.length === 0) {
            await ctx.reply('❌ Корзина пуста. Добавьте товары для заказа.');
            return;
        }
        
        await ctx.reply(
            '📝 ДАННЫЕ ДЛЯ ЗАКАЗА:\n\nВведите ваше имя:',
            Markup.keyboard([['🔙 Назад']]).resize()
        );
        
        ctx.session = ctx.session || {};
        ctx.session.step = 'name';
    } catch (error) {
        await ctx.reply('❌ Ошибка при оформлении заказа');
    }
});

// Обработка данных клиента
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const session = ctx.session;
    
    if (text.includes('🔙 Назад')) {
        ctx.session = {};
        await ctx.reply(
            'Главное меню:',
            Markup.keyboard([
                ['📱 Каталог', '🛒 Корзина'],
                ['📊 Мои заказы', 'ℹ️ О магазине']
            ]).resize()
        );
        return;
    }
    
    if (session.step === 'name') {
        session.customerName = text;
        session.step = 'phone';
        
        await ctx.reply(
            '📱 Введите номер телефона:',
            Markup.keyboard([['🔙 Назад']]).resize()
        );
        
    } else if (session.step === 'phone') {
        if (text.match(/\+?[78]?\d{10,}/)) {
            session.customerPhone = text;
            session.step = 'address';
            
            await ctx.reply(
                '🏠 Введите адрес доставки:',
                Markup.keyboard([['🔙 Назад']]).resize()
            );
        } else {
            await ctx.reply('❌ Введите корректный номер телефона');
        }
        
    } else if (session.step === 'address') {
        session.customerAddress = text;
        
        try {
            const orderId = await createOrder(
                ctx.from.id,
                session.customerName,
                session.customerPhone,
                session.customerAddress
            );
            
            await addOrderItems(orderId, ctx.from.id);
            await clearCart(ctx.from.id);
            
            await ctx.reply(
                `✅ ЗАКАЗ ОФОРМЛЕН!\n\n` +
                `🎫 Номер заказа: #${orderId}\n` +
                `👤 Имя: ${session.customerName}\n` +
                `📱 Телефон: ${session.customerPhone}\n` +
                `🏠 Адрес: ${session.customerAddress}\n\n` +
                `📞 Менеджер свяжется с вами в течение 30 минут`,
                Markup.keyboard([
                    ['📊 Мои заказы'],
                    ['🏠 Главное меню']
                ]).resize()
            );
            
            ctx.session = {};
            
        } catch (error) {
            await ctx.reply('❌ Ошибка при оформлении заказа');
        }
    }
});

// Мои заказы
bot.hears('📊 Мои заказы', async (ctx) => {
    db.all(
        `SELECT o.*, 
         GROUP_CONCAT(p.name, ', ') as products
         FROM orders o 
         LEFT JOIN order_items oi ON o.id = oi.order_id 
         LEFT JOIN products p ON oi.product_id = p.id 
         WHERE o.user_id = ? 
         GROUP BY o.id 
         ORDER BY o.created_at DESC`,
        [ctx.from.id],
        async (err, orders) => {
            if (err) {
                await ctx.reply('❌ Ошибка при получении заказов');
                return;
            }
            
            if (orders.length === 0) {
                await ctx.reply('📝 У вас пока нет заказов');
                return;
            }
            
            let message = '📊 ВАШИ ЗАКАЗЫ:\n\n';
            orders.forEach((order, index) => {
                message += `🎫 Заказ #${order.id}\n`;
                message += `📅 ${order.created_at}\n`;
                message += `💰 Сумма: ${order.total_amount}₽\n`;
                message += `📊 Статус: ${order.status}\n`;
                message += `📞 ${order.customer_name} - ${order.customer_phone}\n\n`;
            });
            
            await ctx.reply(message);
        }
    );
});

// О магазине
bot.hears('ℹ️ О магазине', async (ctx) => {
    await ctx.reply(
        'ℹ️ НАШ МАГАЗИН\n\n' +
        '🏪 Магазин товаров для дома и офиса\n' +
        '📦 Быстрая доставка по городу\n' +
        '💳 Оплата при получении\n' +
        '🔄 Возврат в течение 14 дней\n\n' +
        '📞 Телефон: +7 (999) 123-45-67\n' +
        '📧 Email: shop@example.com\n' +
        '⏰ Время работы: 9:00 - 21:00'
    );
});

// Обработка ошибок
bot.catch((err, ctx) => {
    console.log(`Error for ${ctx.updateType}:`, err);
});

// Запуск бота
bot.launch().then(() => {
    console.log('🛒 Бот интернет-магазина запущен...');
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));