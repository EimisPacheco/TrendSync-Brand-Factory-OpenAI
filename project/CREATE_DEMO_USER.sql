-- Instructions to create the demo user account
-- Since we cannot create auth users directly through SQL, please follow these steps:

-- OPTION 1: Use the signup form
-- 1. Go to the app's landing page
-- 2. Click "Get Started"
-- 3. Click "Create Account"
-- 4. Fill in:
--    - Full Name: Demo User
--    - Email: demo@trendsync.ai
--    - Password: TrendSync2025!
-- 5. Click "Create Account"

-- OPTION 2: Use Supabase Dashboard
-- 1. Go to your Supabase project dashboard
-- 2. Navigate to Authentication > Users
-- 3. Click "Add User" > "Create new user"
-- 4. Fill in:
--    - Email: demo@trendsync.ai
--    - Password: TrendSync2025!
--    - Auto Confirm User: YES (check this box)
-- 5. Click "Create user"

-- After creating the user, run this SQL to set the role to admin:
-- UPDATE user_profiles
-- SET role = 'admin'
-- WHERE id = (SELECT id FROM auth.users WHERE email = 'demo@trendsync.ai');
