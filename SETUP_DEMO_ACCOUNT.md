# Setting Up the Demo Account

## Demo Credentials
- **Email:** demo@trendsync.ai
- **Password:** TrendSync2025!

## Option 1: Create Account via App (Recommended)

1. Open the application in your browser
2. Click "Get Started" on the landing page
3. Click the "Create Account" tab
4. Fill in the registration form:
   - Full Name: `Demo User`
   - Email: `demo@trendsync.ai`
   - Password: `TrendSync2025!`
5. Click "Create Account"
6. The account will be created and you can immediately sign in

## Option 2: Create via Supabase Dashboard

1. Go to your Supabase project dashboard
2. Navigate to **Authentication > Users**
3. Click **"Add User"** > **"Create new user"**
4. Fill in the details:
   - Email: `demo@trendsync.ai`
   - Password: `TrendSync2025!`
   - **Auto Confirm User:** ✅ **YES** (check this box)
5. Click **"Create user"**

## Setting Admin Role

After creating the user, run this SQL in the Supabase SQL Editor to set admin role:

```sql
UPDATE user_profiles
SET role = 'admin'
WHERE id = (SELECT id FROM auth.users WHERE email = 'demo@trendsync.ai');
```

## Adding Gemini API Key

1. Sign in with the demo account
2. Navigate to **Settings** in the sidebar
3. Enter your Gemini API Key from [Google AI Studio](https://aistudio.google.com/app/apikey)
4. Click **"Save Settings"**

The API key will be securely stored in the database and used for:
- AI-powered collection generation
- Trend analysis
- Tech pack generation
- Celebrity fashion insights

## Fallback to Environment Variable

If no API key is set in Settings, the application will fall back to the `VITE_GEMINI_API_KEY` environment variable in your `.env` file.
