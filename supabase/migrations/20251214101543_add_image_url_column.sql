/*
  # Add image_url column to collection_items

  1. Changes
    - Add `image_url` column to `collection_items` table to store generated product images
    - Column is nullable to allow for gradual image generation
  
  2. Notes
    - Existing items will have NULL image_url initially
    - Images will be populated after FIBO generation
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'collection_items' AND column_name = 'image_url'
  ) THEN
    ALTER TABLE collection_items ADD COLUMN image_url text;
  END IF;
END $$;