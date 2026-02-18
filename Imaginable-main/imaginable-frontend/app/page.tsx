"use client";

import { useEffect, useState, useRef } from "react";
import LogoImaginable from "../assets/images/LogoImaginable.png";

type Episode = {
  episode_id: string;
  title: string;
  description: string;
  scene_1_url: string;
  thumbnail_url?: string;
  skills?: string[];
  character_image?: string;
  character_name?: string;
};

const skillColors: { [key: string]: string } = {
  "Math": "bg-blue-500/70",
  "Spatial Reasoning": "bg-purple-500/70",
  "Pattern Recognition": "bg-pink-500/70",
  "Art": "bg-red-500/70",
  "Color Theory": "bg-orange-500/70",
  "Visual Learning": "bg-yellow-500/70",
  "Counting": "bg-green-500/70",
  "Problem Solving": "bg-teal-500/70",
  "Science": "bg-cyan-500/70",
  "Biology": "bg-emerald-500/70",
  "Environmental Awareness": "bg-lime-500/70",
  "Meteorology": "bg-indigo-500/70",
  "Observation": "bg-violet-500/70",
  "Responsible Habits": "bg-green-600/70",
  "Sorting": "bg-amber-500/70",
  "Early Biology": "bg-emerald-600/70",
  "Scientific Thinking": "bg-blue-500/70",
  "Fraction Foundations": "bg-orange-500/70",
  "Part-Whole Relationships": "bg-purple-500/70",
  "Visual Math": "bg-pink-500/70",
};

// Available colors pool for dynamic assignment
const colorPool = [
  "bg-blue-500/70",
  "bg-purple-500/70",
  "bg-pink-500/70",
  "bg-orange-500/70",
  "bg-teal-500/70",
  "bg-cyan-500/70",
  "bg-emerald-500/70",
  "bg-lime-500/70",
  "bg-indigo-500/70",
  "bg-violet-500/70",
  "bg-amber-500/70",
  "bg-red-500/70",
  "bg-green-500/70",
  "bg-yellow-500/70",
];

// Function to get unique colors for skills within an episode
const getSkillColor = (skill: string, episodeSkills: string[], index: number): string => {
  // If skill has a predefined color, use it
  if (skillColors[skill]) {
    return skillColors[skill];
  }
  // Otherwise, assign from color pool ensuring uniqueness within episode
  return colorPool[index % colorPool.length];
};

export default function Home() {
  const texts = [
    "The First Generative Engine for Multimodal Learning Experiences",
    "For a New Era of Immersive, AI-Native Edutainment"
  ];
  const [text, setText] = useState("");
  const [textIndex, setTextIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [isLoadingEpisodes, setIsLoadingEpisodes] = useState(false);
  const [heroVideoIndex, setHeroVideoIndex] = useState(0);
  const [imaginationText, setImaginationText] = useState("");
  const experiencesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const currentText = texts[textIndex];
    const typingSpeed = isDeleting ? 30 : 50;
    // Both texts pause for 2 seconds
    const pauseAfterComplete = 2000;
    const pauseAfterDelete = 500;

    const timeout = setTimeout(() => {
      if (!isDeleting) {
        // Typing forward
        if (text.length < currentText.length) {
          setText(currentText.slice(0, text.length + 1));
        } else {
          // Finished typing, pause then start deleting
          setTimeout(() => setIsDeleting(true), pauseAfterComplete);
        }
      } else {
        // Deleting
        if (text.length > 0) {
          setText(currentText.slice(0, text.length - 1));
        } else {
          // Finished deleting, move to next text
          setIsDeleting(false);
          setTextIndex((prev) => (prev + 1) % texts.length);
          setTimeout(() => {}, pauseAfterDelete);
        }
      }
    }, typingSpeed);

    return () => clearTimeout(timeout);
  }, [text, textIndex, isDeleting]);

  // Typing animation for "Imagination" and "Creative Thinking" words
  useEffect(() => {
    const words = ["Imagination", "Creative Thinking"];
    let wordIndex = 0;
    let currentIndex = 0;
    let isDeleting = false;
    
    const typingInterval = setInterval(() => {
      const currentWord = words[wordIndex];
      
      if (!isDeleting) {
        // Typing forward
        if (currentIndex <= currentWord.length) {
          setImaginationText(currentWord.slice(0, currentIndex));
          currentIndex++;
        } else {
          // Pause at end, then start deleting
          setTimeout(() => {
            isDeleting = true;
          }, 2000);
        }
      } else {
        // Deleting
        if (currentIndex > 0) {
          currentIndex--;
          setImaginationText(currentWord.slice(0, currentIndex));
        } else {
          // Move to next word
          isDeleting = false;
          wordIndex = (wordIndex + 1) % words.length;
        }
      }
    }, isDeleting ? 50 : 100);

    return () => clearInterval(typingInterval);
  }, []);

  useEffect(() => {
    const fetchEpisodes = async () => {
      setIsLoadingEpisodes(true);
      try {
        const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
        const response = await fetch(`${baseUrl}/episodes`);
        if (response.ok) {
          const data = await response.json();
          console.log("Fetched episodes:", data.episodes);
          setEpisodes(data.episodes || []);
        } else {
          console.error("Failed to fetch episodes, status:", response.status);
          setEpisodes([]);
        }
      } catch (error) {
        console.error("Failed to fetch episodes:", error);
        setEpisodes([]);
      } finally {
        setIsLoadingEpisodes(false);
      }
    };

    fetchEpisodes();
  }, []);

  // Cycle through episode videos for hero section
  useEffect(() => {
    if (episodes.length === 0) return;

    const interval = setInterval(() => {
      setHeroVideoIndex((prev) => (prev + 1) % episodes.length);
    }, 8000); // Change video every 8 seconds

    return () => clearInterval(interval);
  }, [episodes.length]);

  const scrollToExperiences = () => {
    experiencesRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const renderTextWithHighlight = () => {
    // Check if it's the second text ("For a New Era...")
    const isSecondText = text.includes("For a New Era");
    const textColor = isSecondText ? "#9ca3af" : "#000000"; // lighter bluish-grey for second text, black for first
    
    const parts = text.split(/(Multimodal)/i);
    return parts.map((part, index) => {
      if (part.toLowerCase() === "multimodal") {
        return (
          <span key={index} style={{ color: "#e85d2a", fontStyle: "italic" }}>
            {part}
          </span>
        );
      }
      return <span key={index} style={{ color: textColor }}>{part}</span>;
    });
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <header className="absolute left-9 top-3 right-8 flex flex-col items-start">
        <div className="w-full rounded-lg border border-[#2F2F2F] bg-transparent px-3 py-2.5">
          <div className="flex items-center gap-12">
            <img
              src={LogoImaginable.src}
              alt="Imaginable logo"
              className="block"
              style={{ width: 340, height: "auto" }}
            />
            <nav className="ml-100 flex items-center gap-10">
              <button
                type="button"
                onClick={scrollToExperiences}
                className="snow-btn rounded-md border border-[#0b286cd4] bg-zinc-50 px-2 py-0.5 font-[var(--font-figtree)] text-[14px] font-normal text-black transition-colors hover:bg-[#2F2F2F] hover:text-white"
              >
                Try Interactive Experiences
              </button>
              <a href="/build">
                <button
                  type="button"
                  className="snow-btn rounded-md border border-zinc-400 bg-[#2F2F2F] px-2 py-0.5 font-[var(--font-figtree)] text-[14px] font-normal text-white transition-colors hover:bg-zinc-50 hover:text-black"
                >
                  Create Your Own Episode
                </button>
              </a>
            </nav>
          </div>
        </div>
        <p className="mt-17 text-[40px] font-normal text-black text-center w-full" style={{ fontFamily: 'var(--font-adamina)' }}>
          {renderTextWithHighlight()}
        </p>
      </header>
      <div
        className="absolute left-0 right-0"
        style={{
          top: '230px',
          minHeight: '1200px',
          background: 'linear-gradient(to bottom, #fafafa 0%, #f5f5f5 100%)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid #e85d2a',
          boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.05), inset 0 1px 0 0 rgba(255, 255, 255, 0.2)',
          borderTopLeftRadius: '89px',
          borderTopRightRadius: '89px',
          borderBottomLeftRadius: '0',
          borderBottomRightRadius: '0',
        }}
      >
        <div className="pt-8 pb-6 px-12 max-w-7xl mx-auto">
          <p className="font-[var(--font-figtree)] text-[20px] leading-relaxed font-normal text-gray-700 text-center max-w-5xl mx-auto">
            For the first time, video becomes a <span className="text-[#e85d2a]">two-way medium</span>.<br />We generate <span className="font-semibold text-gray-900">AI-native video experiences</span> that sense and react to a learner&apos;s ideas, drawings, and voice in real time — powered by <span className="font-semibold text-gray-900">Gemini 3&apos;s</span> frontier multimodal intelligence and reasoning, with Veo and Nano Banana.
          </p>
        </div>

        {/* Experience Carousel */}
        <div ref={experiencesRef} className="mt-8 px-12">
          {isLoadingEpisodes ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-[#e85d2a]"></div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* First Row Carousel */}
              <div className="relative">
                {/* Left Arrow */}
                <button
                  onClick={() => {
                    const container = document.querySelector('.carousel-container-1');
                    if (container) {
                      container.scrollBy({ left: -720, behavior: 'smooth' });
                    }
                  }}
                  className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-black hover:bg-black/80 text-white p-3 rounded-full shadow-lg transition-all hover:scale-110 active:scale-95"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M15 18l-6-6 6-6"/>
                  </svg>
                </button>
                
                {/* Right Arrow */}
                <button
                  onClick={() => {
                    const container = document.querySelector('.carousel-container-1');
                    if (container) {
                      container.scrollBy({ left: 720, behavior: 'smooth' });
                    }
                  }}
                  className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-black hover:bg-black/80 text-white p-3 rounded-full shadow-lg transition-all hover:scale-110 active:scale-95"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 18l6-6-6-6"/>
                  </svg>
                </button>

                <div 
                  className="carousel-container-1 flex gap-6 overflow-x-auto pb-8 scrollbar-hide snap-x snap-mandatory"
                  style={{
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                  }}
                >
                  {episodes.slice(0, 3).map((episode) => (
                  <div
                    key={episode.episode_id}
                    className="flex-shrink-0 w-[680px] snap-start group"
                  >
                    <div 
                      className="relative rounded-2xl overflow-hidden bg-black/20 backdrop-blur-sm border border-white/10 transition-all duration-300 hover:scale-[1.02] hover:border-white/30 hover:shadow-2xl"
                      style={{
                        aspectRatio: '16/9',
                      }}
                    >
                      {/* Autoplaying Video */}
                      <video
                        src={episode.scene_1_url}
                        autoPlay
                        loop
                        muted
                        playsInline
                        className="absolute inset-0 w-full h-full object-cover rounded-2xl"
                      />
                      
                      {/* Gradient Overlay */}
                      <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/20 to-transparent rounded-2xl" />
                      
                      {/* Play Button Overlay - Center */}
                      <div className="absolute inset-0 flex items-center justify-center z-10">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            window.location.href = `/experience/${episode.episode_id}`;
                          }}
                          className="group/play relative bg-white/[0.01] backdrop-blur-md rounded-full p-8 shadow-2xl hover:scale-110 hover:bg-white/5 transition-all duration-300 cursor-pointer"
                        >
                          <svg width="56" height="56" viewBox="0 0 24 24" fill="white" className="opacity-60 group-hover/play:opacity-0 transition-opacity duration-300">
                            <path d="M8 5v14l11-7z"/>
                          </svg>
                          <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/play:opacity-100 transition-opacity duration-300">
                            <span className="bg-black rounded-full px-6 py-3 text-white text-[14px] font-semibold font-[var(--font-figtree)] whitespace-nowrap flex items-center gap-2">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                                <path d="M8 5v14l11-7z"/>
                              </svg>
                              Start Interactive Episode
                            </span>
                          </span>
                        </button>
                      </div>

                      {/* Title - Top Left */}
                      <div className="absolute top-0 left-0 p-6 max-w-[70%]">
                        <h3 className="text-white text-[32px] font-semibold line-clamp-2" style={{ fontFamily: 'var(--font-adamina)' }}>
                          {episode.title}
                        </h3>
                      </div>

                      {/* Views Counter - Top Right */}
                      <div className="absolute top-4 right-4 flex items-center gap-2 bg-white/30 backdrop-blur-sm px-3 py-1.5 rounded-full">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                        <span className="text-white text-[12px] font-medium font-[var(--font-figtree)]">
                          {Math.floor(Math.random() * 90) + 10}
                        </span>
                      </div>

                      {/* Description and Character Info - Bottom */}
                      <div className="absolute bottom-0 left-0 right-0 p-6">
                        <p className="text-gray-200 text-[16px] font-[var(--font-figtree)] mb-3 line-clamp-2">
                          {episode.description}
                        </p>
                        
                        {/* Character Info */}
                        {episode.character_name && episode.character_image && (
                          <div className="flex items-center gap-2">
                            <span className="text-gray-300 text-[13px] font-medium font-[var(--font-figtree)]">
                              Characters in this episode:
                            </span>
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-white/50 shadow-md">
                                <img
                                  src={episode.character_image}
                                  alt={episode.character_name}
                                  className="w-full h-full object-cover object-top scale-150"
                                  style={{ objectPosition: 'center 20%' }}
                                />
                              </div>
                              <span className="text-white text-[13px] font-semibold font-[var(--font-figtree)]">
                                {episode.character_name}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                </div>
              </div>

              {/* Second Row Carousel */}
              <div className="relative">
                {/* Left Arrow */}
                <button
                  onClick={() => {
                    const container = document.querySelector('.carousel-container-2');
                    if (container) {
                      container.scrollBy({ left: -720, behavior: 'smooth' });
                    }
                  }}
                  className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-black hover:bg-black/80 text-white p-3 rounded-full shadow-lg transition-all hover:scale-110 active:scale-95"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M15 18l-6-6 6-6"/>
                  </svg>
                </button>
                
                {/* Right Arrow */}
                <button
                  onClick={() => {
                    const container = document.querySelector('.carousel-container-2');
                    if (container) {
                      container.scrollBy({ left: 720, behavior: 'smooth' });
                    }
                  }}
                  className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-black hover:bg-black/80 text-white p-3 rounded-full shadow-lg transition-all hover:scale-110 active:scale-95"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 18l6-6-6-6"/>
                  </svg>
                </button>

                <div 
                  className="carousel-container-2 flex gap-6 overflow-x-auto pb-8 scrollbar-hide snap-x snap-mandatory"
                  style={{
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                  }}
                >
                  {episodes.slice(3, 7).map((episode) => (
                  <div
                    key={episode.episode_id}
                    className="flex-shrink-0 w-[680px] snap-start group"
                  >
                    <div 
                      className="relative rounded-2xl overflow-hidden bg-black/20 backdrop-blur-sm border border-white/10 transition-all duration-300 hover:scale-[1.02] hover:border-white/30 hover:shadow-2xl"
                      style={{
                        aspectRatio: '16/9',
                      }}
                    >
                      {/* Autoplaying Video */}
                      <video
                        src={episode.scene_1_url}
                        autoPlay
                        loop
                        muted
                        playsInline
                        className="absolute inset-0 w-full h-full object-cover rounded-2xl"
                      />
                      
                      {/* Gradient Overlay */}
                      <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/20 to-transparent rounded-2xl" />
                      
                      {/* Play Button Overlay - Center */}
                      <div className="absolute inset-0 flex items-center justify-center z-10">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            window.location.href = `/experience/${episode.episode_id}`;
                          }}
                          className="group/play relative bg-white/[0.01] backdrop-blur-md rounded-full p-8 shadow-2xl hover:scale-110 hover:bg-white/5 transition-all duration-300 cursor-pointer"
                        >
                          <svg width="56" height="56" viewBox="0 0 24 24" fill="white" className="opacity-60 group-hover/play:opacity-0 transition-opacity duration-300">
                            <path d="M8 5v14l11-7z"/>
                          </svg>
                          <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/play:opacity-100 transition-opacity duration-300">
                            <span className="bg-black rounded-full px-6 py-3 text-white text-[14px] font-semibold font-[var(--font-figtree)] whitespace-nowrap flex items-center gap-2">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                                <path d="M8 5v14l11-7z"/>
                              </svg>
                              Start Interactive Episode
                            </span>
                          </span>
                        </button>
                      </div>

                      {/* Title - Top Left */}
                      <div className="absolute top-0 left-0 p-6 max-w-[70%]">
                        <h3 className="text-white text-[32px] font-semibold line-clamp-2" style={{ fontFamily: 'var(--font-adamina)' }}>
                          {episode.title}
                        </h3>
                      </div>

                      {/* Views Counter - Top Right */}
                      <div className="absolute top-4 right-4 flex items-center gap-2 bg-white/30 backdrop-blur-sm px-3 py-1.5 rounded-full">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                        <span className="text-white text-[12px] font-medium font-[var(--font-figtree)]">
                          {Math.floor(Math.random() * 90) + 10}
                        </span>
                      </div>

                      {/* Description and Character Info - Bottom */}
                      <div className="absolute bottom-0 left-0 right-0 p-6">
                        <p className="text-gray-200 text-[16px] font-[var(--font-figtree)] mb-3 line-clamp-2">
                          {episode.description}
                        </p>
                        
                        {/* Character Info */}
                        {episode.character_name && episode.character_image && (
                          <div className="flex items-center gap-2">
                            <span className="text-gray-300 text-[13px] font-medium font-[var(--font-figtree)]">
                              Characters in this episode:
                            </span>
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-white/50 shadow-md">
                                <img
                                  src={episode.character_image}
                                  alt={episode.character_name}
                                  className="w-full h-full object-cover object-top scale-150"
                                  style={{ objectPosition: 'center 20%' }}
                                />
                              </div>
                              <span className="text-white text-[13px] font-semibold font-[var(--font-figtree)]">
                                {episode.character_name}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Tagline Section */}
        <div className="mt-16 px-8 text-center">
          <p className="text-gray-700 text-[32px] font-medium leading-relaxed max-w-5xl mx-auto" style={{ fontFamily: 'var(--font-figtree)' }}>
            Unlocking <span className="text-orange-500">{imaginationText}</span>: Kids &amp; Parents co-create characters, episodes, and deeply personalized interactive experiences.
          </p>
          <p className="text-gray-600 text-[18px] font-normal leading-relaxed max-w-4xl mx-auto mt-4" style={{ fontFamily: 'var(--font-figtree)' }}>
            Draw a character. Create an episode. Watch multimodal experiences come alive through AI-native <span className="font-semibold">interaction checkpoints</span> — where kids draw, speak, and think with their characters in real time.
          </p>
        </div>

        {/* Platform Demo Video Section */}
        <div className="mt-16 px-8">
          <div className="relative w-full max-w-6xl mx-auto h-[70vh] rounded-3xl overflow-hidden bg-gray-200">
            <iframe
              className="absolute inset-0 w-full h-full"
              src="https://www.youtube.com/embed/Cej5lDxJ-6o"
              title="Platform Demo Video"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            ></iframe>
          </div>
        </div>

        {/* Cinematic Full-Viewport Hero Section */}
        {episodes.length > 0 && (
          <div className="mt-16 px-8 pb-12">
            <div className="relative w-full mx-auto h-[85vh] rounded-3xl overflow-hidden">
              {/* Video Background */}
              <video
                key={heroVideoIndex}
                src={episodes[heroVideoIndex]?.scene_1_url}
                autoPlay
                loop
                muted
                playsInline
                className="absolute inset-0 w-full h-full object-cover"
              />
              
              {/* Dark Gradient Overlay for Text Readability */}
              <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/40 to-black/60" />
              
              {/* Centered Text Overlay */}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-8">
                <h2 className="text-white text-[48px] font-light text-center px-16 leading-tight max-w-5xl line-clamp-2 tracking-wide" style={{ fontFamily: 'var(--font-adamina)' }}>
                  Delivering <span className="italic">Scalable Personalization</span> through Multimodal Experiences
                </h2>
                <button
                  onClick={() => {
                    experiencesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className="px-8 py-4 bg-black text-white rounded-full font-semibold hover:bg-gray-900 transition-all duration-300 shadow-lg hover:scale-105 active:scale-95"
                  style={{ fontFamily: 'var(--font-figtree)' }}
                >
                  Try Now
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
