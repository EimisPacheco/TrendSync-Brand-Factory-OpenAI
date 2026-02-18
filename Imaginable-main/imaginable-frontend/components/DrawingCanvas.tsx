"use client";

import { useRef, useState, useEffect, forwardRef, useImperativeHandle } from 'react';

interface DrawingCanvasProps {
  onImageGenerated: (imageData: string, characterName: string) => void;
}

export interface DrawingCanvasRef {
  toggleEraser: () => void;
  undo: () => void;
  clearCanvas: () => void;
}

const COLORS = [
  '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF',
  '#FFFF00', '#FF00FF', '#00FFFF', '#FFA500', '#800080',
  '#FFC0CB', '#A52A2A', '#808080', '#FFD700', '#00CED1',
  '#FF69B4', '#32CD32', '#FF4500', '#9370DB', '#20B2AA'
];

const DrawingCanvas = forwardRef<DrawingCanvasRef, DrawingCanvasProps>(({ onImageGenerated }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [context, setContext] = useState<CanvasRenderingContext2D | null>(null);
  const [currentColor, setCurrentColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(3);
  const [isEraser, setIsEraser] = useState(false);
  const [history, setHistory] = useState<ImageData[]>([]);
  const [historyStep, setHistoryStep] = useState(-1);

  const saveToHistory = (ctx: CanvasRenderingContext2D) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const newHistory = history.slice(0, historyStep + 1);
    newHistory.push(imageData);
    setHistory(newHistory);
    setHistoryStep(newHistory.length - 1);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = brushSize;
        ctx.strokeStyle = currentColor;
        setContext(ctx);
        
        // Set white background
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Save initial state
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        setHistory([imageData]);
        setHistoryStep(0);
      }
    }
  }, []);


  const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let clientX: number, clientY: number;

    if ('touches' in e) {
      if (e.touches.length === 0) return null;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    return { x, y };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!context) return;
    
    const coords = getCoordinates(e);
    if (!coords) return;

    context.beginPath();
    context.moveTo(coords.x, coords.y);
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !context) return;
    e.preventDefault();

    const coords = getCoordinates(e);
    if (!coords) return;

    context.lineTo(coords.x, coords.y);
    context.strokeStyle = isEraser ? '#FFFFFF' : currentColor;
    context.lineWidth = isEraser ? brushSize * 3 : brushSize;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.stroke();
  };

  const stopDrawing = () => {
    if (isDrawing && context) {
      setIsDrawing(false);
      saveToHistory(context);
      
      const canvas = canvasRef.current;
      if (canvas) {
        const imageData = canvas.toDataURL('image/png');
        onImageGenerated(imageData, '');
      }
    }
  };

  const undo = () => {
    if (historyStep > 0 && context && canvasRef.current) {
      const newStep = historyStep - 1;
      context.putImageData(history[newStep], 0, 0);
      setHistoryStep(newStep);
      
      const imageData = canvasRef.current.toDataURL('image/png');
      onImageGenerated(imageData, '');
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (canvas && context) {
      context.fillStyle = 'white';
      context.fillRect(0, 0, canvas.width, canvas.height);
      saveToHistory(context);
      onImageGenerated('', '');
    }
  };

  useImperativeHandle(ref, () => ({
    toggleEraser: () => setIsEraser(!isEraser),
    undo,
    clearCanvas,
  }));

  return (
    <div className="flex flex-col h-full">
      <div 
        className="rounded-lg overflow-hidden mb-2"
        style={{
          background: '#0b286cd4',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(65, 105, 225, 0.15)',
          boxShadow: '0 8px 32px 0 rgba(65, 105, 225, 0.2), inset 0 1px 0 0 rgba(255, 255, 255, 0.1)',
        }}
      >
        <div className="p-1">
          <canvas
            ref={canvasRef}
            width={380}
            height={280}
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
            onTouchCancel={stopDrawing}
            className="bg-white rounded-lg cursor-crosshair"
            style={{ display: 'block', width: '100%', height: 'auto', touchAction: 'none' }}
          />
        </div>
      </div>

      <div className="rounded-lg p-2 border border-gray-300">
        {/* Color Palette */}
        <div className="mb-1.5">
          <p className="text-xs font-[var(--font-figtree)] font-medium text-gray-700 mb-1">Colors:</p>
          <div className="grid grid-cols-10 gap-1">
            {COLORS.map((color) => (
              <button
                key={color}
                onClick={() => {
                  setCurrentColor(color);
                  setIsEraser(false);
                }}
                className={`w-6 h-6 rounded border transition-all ${
                  currentColor === color && !isEraser
                    ? 'border-black scale-110 ring-2 ring-purple-500'
                    : 'border-gray-300 hover:scale-105'
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>

        {/* Brush Size Slider */}
        <div>
          <label className="text-xs font-[var(--font-figtree)] font-medium text-gray-700">
            Size: {brushSize}px
          </label>
          <input
            type="range"
            min="1"
            max="20"
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer slider-square"
          />
        </div>
      </div>
    </div>
  );
});

DrawingCanvas.displayName = 'DrawingCanvas';

export default DrawingCanvas;
