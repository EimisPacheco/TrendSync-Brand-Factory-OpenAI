"use client";

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import DrawingCanvas, { DrawingCanvasRef } from '@/components/DrawingCanvas';

export default function BuildPage() {
  const router = useRouter();
  const canvasRef = useRef<DrawingCanvasRef>(null);
  const [characterDrawing, setCharacterDrawing] = useState<string>('');
  const [characterName, setCharacterName] = useState<string>('');
  const [generatedCharacter, setGeneratedCharacter] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [storyStyle, setStoryStyle] = useState<'high-quality' | 'claymation'>('high-quality');
  const [episodeTopic, setEpisodeTopic] = useState<string>('');
  const [isGeneratingEpisode, setIsGeneratingEpisode] = useState(false);
  const [episodeError, setEpisodeError] = useState<string | null>(null);
  
  // Access key protection
  const [isAccessGranted, setIsAccessGranted] = useState(false);
  const [accessKeyInput, setAccessKeyInput] = useState('');
  const [accessKeyError, setAccessKeyError] = useState(false);
  
  const handleAccessKeySubmit = () => {
    if (accessKeyInput === 'imaginable2468') {
      setIsAccessGranted(true);
      setAccessKeyError(false);
    } else {
      setAccessKeyError(true);
    }
  };
  
  // Topic chips for quick selection
  const topicChips = [
    'How Plants Grow', 'The Water Cycle', 'Pollination', 'Animal Habitats',
    'Life Cycles', 'Weather Wonders', 'Seasons on Earth', 'Food Chains',
    'Ocean Ecosystems', 'The Power of Sunlight', 'My Five Senses', 'What Floats? What Sinks?',
    'Warm vs Cold', 'Day and Night', 'Rainy vs Sunny', 'Wind at Work',
    'Shadows and Light', 'Growing Things', 'Healthy Food Choices', 'Recycling Heroes',
    'Saving Energy', 'Growing a Garden', 'Smart Shopping', 'Community Helpers',
    'Safety Smarts', 'Caring for the Earth', 'Fraction Fun', 'Shape Explorers',
    'Counting Adventures', 'Symmetry Studio', 'Geometry Builders', 'Math in the Kitchen'
  ];
  
  const chipColors = [
    'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-pink-500',
    'bg-yellow-500', 'bg-indigo-500', 'bg-red-500', 'bg-teal-500'
  ];
  
  const getChipColor = (index: number) => chipColors[index % chipColors.length];

  const handleImageGenerated = (imageData: string) => {
    setCharacterDrawing(imageData);
  };

  const handleGenerateCharacter = async () => {
    if (!characterName.trim() || !characterDrawing) return;
    
    setIsGenerating(true);
    
    try {
      // Convert base64 to blob for upload
      const base64Data = characterDrawing.split(',')[1];
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'image/png' });
      
      // Create form data
      const formData = new FormData();
      formData.append('drawing_image', blob, 'character_drawing.png');
      formData.append('character_name', characterName);
      
      // Call backend API
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
      const response = await fetch(`${baseUrl}/generate-character`, {
        method: 'POST',
        body: formData,
      });
      
      const data = await response.json();
      
      if (data.success && data.character_image_base64) {
        // Set the generated character image
        setGeneratedCharacter(`data:image/png;base64,${data.character_image_base64}`);
      } else {
        // Display user-friendly error message
        const errorMsg = data.error || 'Unknown error';
        alert(errorMsg);
      }
    } catch (error) {
      console.error('Error generating character:', error);
      alert('That didn\'t work, we could be facing high demand. Please try a different drawing. Keep it kid-appropriate and avoid characters or logos that resemble copyrighted IP.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateEpisode = async () => {
    if (!episodeTopic.trim() || !generatedCharacter) return;
    
    setIsGeneratingEpisode(true);
    setEpisodeError(null);
    
    try {
      // Convert generated character image to blob
      const base64Data = generatedCharacter.split(',')[1];
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'image/png' });
      
      // Create form data
      const formData = new FormData();
      formData.append('episode_topic', episodeTopic);
      formData.append('story_style', storyStyle);
      formData.append('character_description', characterName);
      formData.append('character_image', blob, 'character.png');
      
      console.log('[Generate Episode] Sending request to backend...');
      
      // Call backend API
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
      const response = await fetch(`${baseUrl}/generate-episode`, {
        method: 'POST',
        body: formData,
      });
      
      const data = await response.json();
      
      if (data.success && data.episode) {
        console.log('[Generate Episode] Success! Episode generated:', data.episode.episode_id);
        // Navigate to episode playback page
        router.push(`/experience/${data.episode.episode_id}`);
      } else {
        const errorMsg = data.error || 'Unknown error';
        console.error('[Generate Episode] Failed:', errorMsg);
        setEpisodeError(errorMsg);
        alert(`Episode generation failed: ${errorMsg}`);
      }
    } catch (error) {
      console.error('[Generate Episode] Error:', error);
      const errorMsg = 'Failed to generate episode. Please try again.';
      setEpisodeError(errorMsg);
      alert(errorMsg);
    } finally {
      setIsGeneratingEpisode(false);
    }
  };

  return (
    <div className="relative flex flex-col h-screen overflow-y-auto bg-gray-100 font-sans dark:bg-black">
      {/* Access Key Modal */}
      {!isAccessGranted && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
            <h2 className="text-2xl font-[var(--font-adamina)] text-black mb-2">Access Required</h2>
            <p className="text-sm font-[var(--font-figtree)] text-gray-600 mb-6">
              Please enter the access key to create your own episode.
            </p>
            <input
              type="password"
              value={accessKeyInput}
              onChange={(e) => {
                setAccessKeyInput(e.target.value);
                setAccessKeyError(false);
              }}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleAccessKeySubmit();
                }
              }}
              placeholder="Enter access key"
              className={`w-full px-4 py-3 border ${
                accessKeyError ? 'border-red-500' : 'border-gray-300'
              } rounded-lg text-sm font-[var(--font-figtree)] focus:outline-none focus:border-[#0b286cd4] focus:ring-2 focus:ring-[#0b286cd4]/20 mb-4`}
              autoFocus
            />
            {accessKeyError && (
              <p className="text-xs font-[var(--font-figtree)] text-red-500 mb-4">
                Incorrect access key. Please try again.
              </p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => router.push('/')}
                className="flex-1 px-4 py-3 rounded-lg bg-gray-100 text-gray-700 text-sm font-[var(--font-figtree)] font-medium hover:bg-gray-200 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleAccessKeySubmit}
                className="flex-1 px-4 py-3 rounded-lg bg-[#0b286cd4] text-white text-sm font-[var(--font-figtree)] font-medium hover:bg-black transition-all"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
      
      <header className="absolute left-9 top-3 right-8 z-10">
        <div className="w-full rounded-lg border border-[#2F2F2F] bg-transparent px-3 py-2.5">
          <div className="flex items-center gap-12">
            <img
              src="/LogoImaginable.png"
              alt="Treehouse logo"
              className="block"
              style={{ width: 270, height: "auto" }}
            />
            <nav className="ml-100 flex items-center gap-10">
              <a href="/">
                <button
                  type="button"
                  className="snow-btn rounded-md border border-zinc-400 bg-[#2F2F2F] px-2 py-0.5 font-[var(--font-figtree)] text-[14px] font-normal text-white transition-colors hover:bg-zinc-50 hover:text-black"
                >
                  Home
                </button>
              </a>
              <a href="/build">
                <button
                  type="button"
                  className="snow-btn rounded-md border border-[#0b286cd4] bg-zinc-50 px-2 py-0.5 font-[var(--font-figtree)] text-[14px] font-normal text-black transition-colors hover:bg-[#2F2F2F] hover:text-white"
                >
                  Create Your Own Episode
                </button>
              </a>
            </nav>
          </div>
        </div>
      </header>

      {/* Character Studio */}
      <div className="w-full flex-1 pt-33 pb-4">
        <div className="max-w-6xl mx-auto px-8">
          {currentStep === 1 ? (
          <div className="grid grid-cols-2 gap-4">
          {/* Left: Drawing Canvas and Tools */}
          <div className="flex flex-col">
            <h2 className="text-lg font-normal text-black mb-2 ml-[108px]" style={{ fontFamily: 'var(--font-adamina)' }}>
              Draw Your Character
            </h2>
            <div className="flex gap-3">
              {/* Tool Buttons Column */}
              <div className="flex flex-col gap-2 w-24">
                <button
                  onClick={() => canvasRef.current?.toggleEraser()}
                  className="px-2 py-2 rounded border border-[#0b286cd4] bg-gray-100 text-gray-700 font-[var(--font-figtree)] text-xs font-medium hover:bg-gray-200 transition-all"
                >
                  Eraser
                </button>
                <button
                  onClick={() => canvasRef.current?.undo()}
                  className="px-2 py-2 rounded border border-[#0b286cd4] bg-gray-100 text-gray-700 font-[var(--font-figtree)] text-xs font-medium hover:bg-gray-200 transition-all"
                >
                  Undo
                </button>
                <button
                  onClick={() => canvasRef.current?.clearCanvas()}
                  className="px-2 py-2 rounded border border-[#0b286cd4] bg-gray-100 text-gray-700 font-[var(--font-figtree)] text-xs font-medium hover:bg-gray-200 transition-all"
                >
                  Clear
                </button>
              </div>
              {/* Canvas */}
              <div className="flex-1">
                <DrawingCanvas ref={canvasRef} onImageGenerated={handleImageGenerated} />
              </div>
            </div>
          </div>

          {/* Right: Character Generation */}
          <div className="flex flex-col">
            <h2 className="text-lg font-normal text-black mb-2" style={{ fontFamily: 'var(--font-adamina)' }}>
              Bring them to life
            </h2>
            
            {/* Character Name Input */}
            <div className="mb-2">
              <label htmlFor="character-name" className="block text-xs font-[var(--font-figtree)] font-normal text-black mb-1">
                Character Name
              </label>
              <input
                id="character-name"
                type="text"
                value={characterName}
                onChange={(e) => setCharacterName(e.target.value)}
                placeholder="Enter character name"
                className="w-full px-2 py-1.5 border border-[#0b286cd4] rounded-lg text-xs font-[var(--font-figtree)] focus:outline-none focus:border-[#4169E1] focus:ring-1 focus:ring-[#4169E1]/20"
                maxLength={20}
              />
            </div>

            {/* Generate Button */}
            <button
              onClick={handleGenerateCharacter}
              disabled={!characterName.trim() || !characterDrawing || isGenerating}
              className={`w-full text-xs font-[var(--font-figtree)] font-medium py-1.5 rounded-lg transition-all mb-3 ${
                characterName.trim() && characterDrawing && !isGenerating
                  ? 'bg-[#0b286cd4] text-white hover:bg-black cursor-pointer'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              {isGenerating ? 'Generating...' : 'Generate Character'}
            </button>

            {/* Generated Character Display */}
            <div 
              className="flex-1 rounded-lg overflow-hidden mb-2"
              style={{
                background: '#0b286cd4',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid rgba(65, 105, 225, 0.15)',
                boxShadow: '0 8px 32px 0 rgba(65, 105, 225, 0.2), inset 0 1px 0 0 rgba(255, 255, 255, 0.1)',
              }}
            >
              <div className="flex items-center justify-center h-full p-4">
                {isGenerating ? (
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-white mx-auto mb-3"></div>
                    <p className="text-sm font-[var(--font-figtree)] text-white">
                      Creating your character...
                    </p>
                  </div>
                ) : generatedCharacter ? (
                  <div className="w-full h-full flex flex-col items-center justify-center">
                    <img 
                      src={generatedCharacter} 
                      alt={`Generated character: ${characterName}`}
                      className="max-w-full max-h-full object-contain rounded-lg"
                    />
                    <p className="text-xs font-[var(--font-figtree)] text-white mt-2">
                      {characterName}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs font-[var(--font-figtree)] text-white/70 text-center">
                    Draw your character and click<br />
                    &quot;Generate Character&quot; to see the magic!
                  </p>
                )}
              </div>
            </div>
            
            {/* Next Button - Only show after character is generated */}
            {generatedCharacter && (
              <button
                onClick={() => setCurrentStep(2)}
                className="w-full text-xs font-[var(--font-figtree)] font-medium py-1.5 rounded-lg transition-all bg-[#0b286cd4] text-white hover:bg-black cursor-pointer flex items-center justify-center gap-2"
              >
                Next
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </button>
            )}
          </div>
          </div>
          ) : (
          <div className="flex justify-center items-start">
          {/* Step 2: Episode Setup Card */}
          <div className="flex flex-col w-full max-w-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-normal text-black" style={{ fontFamily: 'var(--font-adamina)' }}>
                Episode Setup
              </h2>
              <span className="text-xs font-[var(--font-figtree)] text-gray-500">Step 2 of 2</span>
            </div>
            
            {/* Episode Topic Input */}
            <div className="mb-4">
              <label htmlFor="episode-topic" className="block text-sm font-[var(--font-figtree)] font-medium text-black mb-2">
                Episode Topic <span className="text-red-500">*</span>
              </label>
              <div 
                className="rounded-[24px] overflow-hidden w-full"
                style={{
                  background: 'rgba(255, 255, 255, 0.9)',
                  border: '1px solid rgba(0, 0, 0, 0.1)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
                }}
              >
                <div className="flex items-center px-4 py-3">
                  <textarea
                    id="episode-topic"
                    value={episodeTopic}
                    onChange={(e) => setEpisodeTopic(e.target.value)}
                    placeholder="Enter episode topic or select from chips below..."
                    className="flex-1 bg-transparent text-sm font-[var(--font-figtree)] text-gray-700 placeholder-gray-400 focus:outline-none resize-none overflow-hidden"
                    rows={2}
                    style={{ minHeight: '48px' }}
                    onInput={(e) => {
                      const target = e.target as HTMLTextAreaElement;
                      target.style.height = 'auto';
                      target.style.height = target.scrollHeight + 'px';
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Topic Chips */}
            <div className="mb-4">
              <label className="block text-xs font-[var(--font-figtree)] font-medium text-black mb-2">
                Quick Select Topics
              </label>
              <div className="flex flex-wrap gap-2 max-h-64 overflow-y-auto p-2 bg-gray-50 rounded-lg border border-gray-200">
                {topicChips.map((topic, index) => (
                  <button
                    key={index}
                    onClick={() => setEpisodeTopic(topic)}
                    className={`px-3 py-1.5 rounded-full text-xs font-[var(--font-figtree)] font-medium text-white transition-all hover:scale-105 active:scale-95 ${
                      getChipColor(index)
                    } ${episodeTopic === topic ? 'ring-2 ring-black ring-offset-2' : ''}`}
                  >
                    {topic}
                  </button>
                ))}
              </div>
            </div>
            
            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setCurrentStep(1)}
                className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-[var(--font-figtree)] font-medium hover:bg-gray-200 transition-all flex items-center gap-2"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
                Back
              </button>
              <button
                onClick={handleGenerateEpisode}
                disabled={!episodeTopic.trim() || !generatedCharacter || isGeneratingEpisode}
                className={`flex-1 px-6 py-2 rounded-lg text-sm font-[var(--font-figtree)] font-medium transition-all ${
                  episodeTopic.trim() && generatedCharacter && !isGeneratingEpisode
                    ? 'bg-[#0b286cd4] text-white hover:bg-black cursor-pointer'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                {isGeneratingEpisode ? 'Generating Episode...' : 'Generate Episode'}
              </button>
            </div>
          </div>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
