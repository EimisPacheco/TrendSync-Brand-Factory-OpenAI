/*
  # Add subcategory column to collection_items

  1. Changes
    - Add `subcategory` column to `collection_items` table
    - This field stores the specific product subcategory (e.g., "t-shirt", "sneakers", "backpack")
  
  2. Notes
    - Uses IF NOT EXISTS to prevent errors if column already exists
    - Sets default value to empty string for consistency with other text fields
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'collection_items' AND column_name = 'subcategory'
  ) THEN
    ALTER TABLE collection_items ADD COLUMN subcategory text DEFAULT ''::text;
  END IF;
END $$;