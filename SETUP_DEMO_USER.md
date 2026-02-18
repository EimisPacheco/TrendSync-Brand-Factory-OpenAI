# Setting Up the Demo User

This guide explains how to create and configure the demo account for hackathon judges.

## ⚠️ IMPORTANT: The Account Must Be Created First!

**The demo account does NOT exist yet in the database.** You will get "Invalid login credentials" error until you create it.

## Step 1: Create the Demo Account

1. Open the application in your browser
2. Click "Create Account" on the login page
3. Fill in the following details:
   - **Full Name:** `Demo User`
   - **Email:** `demo@trendsync.ai`
   - **Password:** `TrendSync2025!`
4. Click "Create Account"
5. The account will be created with the default role `designer`

## Step 2: Upgrade to Admin Role

After creating the account, you need to manually set the role to `admin` in the database.

### Option A: Using Supabase Dashboard

1. Go to your Supabase project dashboard
2. Navigate to **Table Editor** → **user_profiles**
3. Find the row where `full_name = 'Demo User'` or email matches `demo@trendsync.ai`
4. Click on the `role` field and change it from `designer` to `admin`
5. Save the changes

### Option B: Using SQL Editor

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Run the following query:

```sql
-- Update demo user to admin role
UPDATE user_profiles
SET role = 'admin'
WHERE id IN (
  SELECT id FROM auth.users WHERE email = 'demo@trendsync.ai'
);
```

## Step 3: Verify Admin Access

1. Sign in with the demo credentials:
   - Email: `demo@trendsync.ai`
   - Password: `TrendSync2025!`
2. Navigate to different sections of the app
3. Verify that all features are accessible

## Important Notes

- The demo account is **shared** among all hackathon judges
- All data created by the demo user will be visible to other judges using the same account
- The admin role provides full access to all features and data
- For production use, consider creating individual judge accounts with appropriate permissions

## Role Hierarchy

- **Admin:** Full access to all features, can view all user data
- **Designer:** Can create and manage their own collections and brand styles
- **Viewer:** Read-only access to shared collections (future enhancement)

## Troubleshooting

### "Invalid credentials" error
- Verify the email is exactly: `demo@trendsync.ai`
- Verify the password is exactly: `TrendSync2025!`
- Check that the account was created successfully in Supabase Auth

### Role not updating
- Make sure you're editing the `user_profiles` table, not `auth.users`
- The role column uses the `user_role` enum type
- Valid values are: `'admin'`, `'designer'`, or `'viewer'`

### Can't see admin features
- Verify the role was updated correctly in the database
- Try signing out and signing in again to refresh the session
- Check browser console for any authentication errors
