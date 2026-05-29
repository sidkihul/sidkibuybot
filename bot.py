import asyncio
import sqlite3
import time
from aiogram import Bot, Dispatcher, F
from aiogram.types import (
    Message, CallbackQuery, LabeledPrice, PreCheckoutQuery,
    InlineKeyboardMarkup, InlineKeyboardButton
)
from aiogram.filters import CommandStart, Command
from aiogram.utils.keyboard import InlineKeyboardBuilder

# --- CONFIGURATION ---
BOT_TOKEN = "8650706516:AAHw04CwFcdy5uvQjeaasHAkr1QL1yTl3ac"
PROVIDER_TOKEN = "YOUR_RAZORPAY_TOKEN_HERE" # From BotFather
ADMIN_ID = 123456789 # Replace with your Telegram User ID

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

# --- DATABASE SETUP ---
def init_db():
    conn = sqlite3.connect("hosting.db")
    c = conn.cursor()
    # User profiles and wallet
    c.execute('''CREATE TABLE IF NOT EXISTS users
                 (user_id INTEGER PRIMARY KEY, wallet REAL DEFAULT 0, is_premium INTEGER DEFAULT 0)''')
    # Time-bound bot access
    c.execute('''CREATE TABLE IF NOT EXISTS active_bots
                 (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, bot_count INTEGER, expires_at REAL)''')
    # Purchase history
    c.execute('''CREATE TABLE IF NOT EXISTS purchases
                 (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount REAL, timestamp REAL)''')
    conn.commit()
    conn.close()

def get_user(user_id):
    conn = sqlite3.connect("hosting.db")
    c = conn.cursor()
    c.execute("SELECT wallet, is_premium FROM users WHERE user_id = ?", (user_id,))
    res = c.fetchone()
    conn.close()
    return res

def add_user(user_id):
    conn = sqlite3.connect("hosting.db")
    c = conn.cursor()
    c.execute("INSERT OR IGNORE INTO users (user_id) VALUES (?)", (user_id,))
    conn.commit()
    conn.close()

# --- USER DASHBOARD ---
@dp.message(CommandStart())
async def start_cmd(message: Message):
    add_user(message.from_user.id)
    
    builder = InlineKeyboardBuilder()
    builder.button(text="👤 My Profile & Wallet", callback_data="profile")
    builder.button(text="🛒 Buy Hosted Bots", callback_data="buy_bots")
    builder.button(text="📞 Contact Admin", url="https://t.me/your_admin_handle")
    builder.adjust(1)
    
    await message.answer("Welcome to the Premium Bot Hosting Service.", reply_markup=builder.as_markup())

@dp.callback_query(F.data == "profile")
async def show_profile(callback: CallbackQuery):
    user = get_user(callback.from_user.id)
    
    conn = sqlite3.connect("hosting.db")
    c = conn.cursor()
    c.execute("SELECT SUM(bot_count) FROM active_bots WHERE user_id = ?", (callback.from_user.id,))
    active = c.fetchone()[0] or 0
    conn.close()
    
    text = (f"**Premium Dashboard**\n\n"
            f"💰 Wallet Balance: ₹{user[0]}\n"
            f"👑 Status: {'Premium' if user[1] else 'Standard'}\n"
            f"🤖 Working Bots: {active}\n\n"
            f"To view purchase history, request it via support.")
    
    builder = InlineKeyboardBuilder()
    builder.button(text="🔙 Back", callback_data="main_menu")
    
    await callback.message.edit_text(text, reply_markup=builder.as_markup(), parse_mode="Markdown")

@dp.callback_query(F.data == "main_menu")
async def back_to_main(callback: CallbackQuery):
    builder = InlineKeyboardBuilder()
    builder.button(text="👤 My Profile & Wallet", callback_data="profile")
    builder.button(text="🛒 Buy Hosted Bots", callback_data="buy_bots")
    builder.button(text="📞 Contact Admin", url="https://t.me/your_admin_handle")
    builder.adjust(1)
    await callback.message.edit_text("Welcome back.", reply_markup=builder.as_markup())

# --- PURCHASING & AUTOMATED ACCESS ---
@dp.callback_query(F.data == "buy_bots")
async def buy_bots_menu(callback: CallbackQuery):
    builder = InlineKeyboardBuilder()
    builder.button(text="15 Bots (24 Hours) - ₹30", callback_data="invoice_15_24")
    builder.button(text="🔙 Back", callback_data="main_menu")
    builder.adjust(1)
    
    await callback.message.edit_text("Select a hosting package. Access will be automatically revoked after the duration expires.", reply_markup=builder.as_markup())

@dp.callback_query(F.data == "invoice_15_24")
async def send_hosting_invoice(callback: CallbackQuery):
    # Telegram expects prices in the smallest currency unit (paise for INR, so ₹30 = 3000)
    price = LabeledPrice(label="15 Hosted Bots (24h)", amount=30 * 100)
    
    await bot.send_invoice(
        chat_id=callback.from_user.id,
        title="Premium Hosting: 15 Bots",
        description="24 hours of premium server access for 15 bots.",
        payload="bot_pkg_15_24",
        provider_token=PROVIDER_TOKEN,
        currency="INR",
        prices=[price]
    )
    await callback.answer()

@dp.pre_checkout_query()
async def pre_checkout_handler(pre_checkout: PreCheckoutQuery):
    # Confirms to Telegram that the bot is ready to process the order
    await bot.answer_pre_checkout_query(pre_checkout.id, ok=True)

@dp.message(F.successful_payment)
async def successful_payment_handler(message: Message):
    user_id = message.from_user.id
    amount = message.successful_payment.total_amount / 100 
    
    # Calculate expiration (24 hours from the exact moment of payment)
    expires_at = time.time() + (24 * 3600)
    
    conn = sqlite3.connect("hosting.db")
    c = conn.cursor()
    # Grant access 
    c.execute("INSERT INTO active_bots (user_id, bot_count, expires_at) VALUES (?, ?, ?)", (user_id, 15, expires_at))
    # Upgrade profile
    c.execute("UPDATE users SET is_premium = 1 WHERE user_id = ?", (user_id,))
    # Log transaction
    c.execute("INSERT INTO purchases (user_id, amount, timestamp) VALUES (?, ?, ?)", (user_id, amount, time.time()))
    conn.commit()
    conn.close()
    
    await message.answer("✅ Payment successful! You have been granted premium access for 15 bots for the next 24 hours.")

# --- ADMIN DASHBOARD ---
@dp.message(Command("admin"))
async def admin_panel(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
        
    conn = sqlite3.connect("hosting.db")
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM users")
    total_users = c.fetchone()[0]
    c.execute("SELECT SUM(amount) FROM purchases")
    total_rev = c.fetchone()[0] or 0.0
    conn.close()
    
    text = (f"🛠 **Admin Dashboard**\n\n"
            f"👥 Total Users: {total_users}\n"
            f"💸 Total Revenue: ₹{total_rev}\n\n"
            f"*(Custom logic for adding wallet balance or removing bots can be hooked into standard aiogram commands here.)*")
            
    await message.answer(text, parse_mode="Markdown")

# --- BACKGROUND EXPIRATION LOOP ---
async def check_expirations():
    """Runs continuously in the background to remove expired bot access."""
    while True:
        conn = sqlite3.connect("hosting.db")
        c = conn.cursor()
        current_time = time.time()
        
        # Find subscriptions that have passed their expiration timestamp
        c.execute("SELECT user_id, bot_count FROM active_bots WHERE expires_at < ?", (current_time,))
        expired = c.fetchall()
        
        if expired:
            # Revoke the database records automatically
            c.execute("DELETE FROM active_bots WHERE expires_at < ?", (current_time,))
            conn.commit()
            
            # Notify users their time is up
            for row in expired:
                try:
                    await bot.send_message(row[0], f"⚠️ Your 24-hour hosting for {row[1]} bots has expired. Access has been automatically revoked.")
                except Exception:
                    pass # Fails silently if the user blocked the bot
                    
        conn.close()
        await asyncio.sleep(60) # Check the database every 60 seconds

async def main():
    init_db()
    # Start the background task alongside the bot's standard operation
    asyncio.create_task(check_expirations())
    print("Bot is running...")
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
