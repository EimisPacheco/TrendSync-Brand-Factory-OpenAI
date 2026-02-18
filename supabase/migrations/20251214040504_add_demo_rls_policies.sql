/*
  # Add Demo RLS Policies

  1. Purpose
    - Enable public access for demo application
    - Allow all operations on brands, collections, and related tables
    
  2. Policies Created
    - Public read/write access for brands table
    - Public read/write access for brand_styles table
    - Public read/write access for collections table
    - Public read/write access for collection_items table
    - Public read/write access for trend_insights table
    - Public read/write access for generated_images table
    - Public read/write access for validations table
    - Public read/write access for tech_packs table
    - Public read/write access for generation_jobs table
  
  3. Security Notes
    - These are permissive policies for demo purposes only
    - In production, implement proper authentication and authorization
*/

-- Brands table policies
CREATE POLICY "Allow public read brands"
  ON brands FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow public insert brands"
  ON brands FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow public update brands"
  ON brands FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public delete brands"
  ON brands FOR DELETE
  TO anon, authenticated
  USING (true);

-- Brand styles table policies
CREATE POLICY "Allow public read brand_styles"
  ON brand_styles FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow public insert brand_styles"
  ON brand_styles FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow public update brand_styles"
  ON brand_styles FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public delete brand_styles"
  ON brand_styles FOR DELETE
  TO anon, authenticated
  USING (true);

-- Collections table policies
CREATE POLICY "Allow public read collections"
  ON collections FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow public insert collections"
  ON collections FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow public update collections"
  ON collections FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public delete collections"
  ON collections FOR DELETE
  TO anon, authenticated
  USING (true);

-- Collection items table policies
CREATE POLICY "Allow public read collection_items"
  ON collection_items FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow public insert collection_items"
  ON collection_items FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow public update collection_items"
  ON collection_items FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public delete collection_items"
  ON collection_items FOR DELETE
  TO anon, authenticated
  USING (true);

-- Trend insights table policies
CREATE POLICY "Allow public read trend_insights"
  ON trend_insights FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow public insert trend_insights"
  ON trend_insights FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow public update trend_insights"
  ON trend_insights FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public delete trend_insights"
  ON trend_insights FOR DELETE
  TO anon, authenticated
  USING (true);

-- Generated images table policies
CREATE POLICY "Allow public read generated_images"
  ON generated_images FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow public insert generated_images"
  ON generated_images FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow public update generated_images"
  ON generated_images FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public delete generated_images"
  ON generated_images FOR DELETE
  TO anon, authenticated
  USING (true);

-- Validations table policies
CREATE POLICY "Allow public read validations"
  ON validations FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow public insert validations"
  ON validations FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow public update validations"
  ON validations FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public delete validations"
  ON validations FOR DELETE
  TO anon, authenticated
  USING (true);

-- Tech packs table policies
CREATE POLICY "Allow public read tech_packs"
  ON tech_packs FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow public insert tech_packs"
  ON tech_packs FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow public update tech_packs"
  ON tech_packs FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public delete tech_packs"
  ON tech_packs FOR DELETE
  TO anon, authenticated
  USING (true);

-- Generation jobs table policies
CREATE POLICY "Allow public read generation_jobs"
  ON generation_jobs FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow public insert generation_jobs"
  ON generation_jobs FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow public update generation_jobs"
  ON generation_jobs FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public delete generation_jobs"
  ON generation_jobs FOR DELETE
  TO anon, authenticated
  USING (true);
