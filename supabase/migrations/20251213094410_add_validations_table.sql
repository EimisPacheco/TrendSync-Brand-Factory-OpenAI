/*
  # Add Validations Table for Brand Guardian
  
  1. New Tables
    - `validations` - Tracks Brand Guardian validation history
      - `id` (uuid, primary key)
      - `collection_item_id` (uuid, references collection_items)
      - `compliance_score` (numeric) - Overall score 0-100
      - `violations` (jsonb) - Array of violation objects with rule, severity, detected, allowed
      - `auto_fixes_applied` (jsonb) - Array of auto-fix actions taken
      - `original_prompt_json` (jsonb) - Original FIBO prompt before fixes
      - `fixed_prompt_json` (jsonb) - Corrected FIBO prompt after fixes
      - `validated_at` (timestamptz)
  
  2. Security
    - Enable RLS
    - Users can only view/create validations for their own collection items
*/

CREATE TABLE IF NOT EXISTS validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_item_id uuid REFERENCES collection_items(id) ON DELETE CASCADE NOT NULL,
  compliance_score numeric(5,2) NOT NULL DEFAULT 0,
  violations jsonb DEFAULT '[]'::jsonb,
  auto_fixes_applied jsonb DEFAULT '[]'::jsonb,
  original_prompt_json jsonb DEFAULT '{}'::jsonb,
  fixed_prompt_json jsonb DEFAULT '{}'::jsonb,
  validated_at timestamptz DEFAULT now()
);

ALTER TABLE validations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own validations"
  ON validations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM collection_items
      JOIN collections ON collections.id = collection_items.collection_id
      JOIN brands ON brands.id = collections.brand_id
      WHERE collection_items.id = validations.collection_item_id
      AND brands.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create own validations"
  ON validations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM collection_items
      JOIN collections ON collections.id = collection_items.collection_id
      JOIN brands ON brands.id = collections.brand_id
      WHERE collection_items.id = validations.collection_item_id
      AND brands.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_validations_collection_item_id ON validations(collection_item_id);
CREATE INDEX IF NOT EXISTS idx_validations_compliance_score ON validations(compliance_score);