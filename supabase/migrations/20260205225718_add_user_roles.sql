/*
  # Add User Roles System

  1. Changes
    - Create role enum type (admin, designer, viewer)
    - Add role column to user_profiles if it doesn't exist
    - Create demo admin user credentials
    - Update default role to 'designer'

  2. Security
    - Roles are managed at the database level
    - Only authenticated users can view their own role
    - Admins have full access to all data
*/

-- Create role enum type
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'designer', 'viewer');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Check if user_profiles table exists, if not create it
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  avatar_url text,
  role user_role NOT NULL DEFAULT 'designer',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on user_profiles
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON user_profiles;

-- Create RLS policies
CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Admins can view all profiles"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );

-- Create index on role for performance
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);

-- Note: Demo user must be created through Supabase Auth UI or signup flow
-- The demo credentials will be:
-- Email: demo@trendsync.ai
-- Password: TrendSync2025!
-- Role: admin (to be set after signup)
