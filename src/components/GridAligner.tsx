import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Settings, Check, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

interface Point {
  x: number;
  y: number;
}

interface GridAlignerProps {
  imageUrl: string;
  onRecognize: (cells: { x: number; y: number; width: number; height: number; row: number; col: number }[], imageElement: HTMLImageElement, rows: number, cols: number) => Promise<void>;
  progress?: number | null;
}

export function GridAligner({ imageUrl, onRecognize, progress }: GridAlignerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [rowsInput, setRowsInput] = useState<string>('20');
  const [colsInput, setColsInput] = useState<string>('20');
  const rows = Math.max(1, parseInt(rowsInput) || 1);
  const cols = Math.max(1, parseInt(colsInput) || 1);
  
  const [tl, setTl] = useState<Point>({ x: 50, y: 50 });
  const [br, setBr] = useState<Point>({ x: 250, y: 250 });
  const [dragging, setDragging] = useState<'tl' | 'br' | 'all' | null>(null);
  const [dragStart, setDragStart] = useState<{ mouse: Point, tl: Point, br: Point } | null>(null);
  const [scale, setScale] = useState(1);
  const [isRecognizing, setIsRecognizing] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImage(img);
      // Initial points based on image size, enforcing square cells
      const initialWidth = img.width * 0.8;
      const cellWidth = initialWidth / cols;
      const initialHeight = cellWidth * rows;
      
      const initialTl = { x: img.width * 0.1, y: img.height * 0.1 };
      const initialBr = { x: initialTl.x + initialWidth, y: initialTl.y + initialHeight };
      setTl(initialTl);
      setBr(initialBr);
      
      if (containerRef.current) {
        const containerWidth = containerRef.current.clientWidth;
        const s = Math.min(1, containerWidth / img.width);
        setScale(s);
      }
    };
    img.src = imageUrl;
  }, [imageUrl]); // Removed rows/cols dependency to avoid resetting on input change

  // Enforce square cells when rows/cols change
  useEffect(() => {
    if (image) {
      const currentWidth = br.x - tl.x;
      const cellWidth = currentWidth / cols;
      const newHeight = cellWidth * rows;
      setBr(prev => ({ ...prev, y: tl.y + newHeight }));
    }
  }, [rows, cols]);

  useEffect(() => {
    if (!image || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = image.width;
    canvas.height = image.height;

    // Draw image
    ctx.drawImage(image, 0, 0);

    // Draw grid
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
    ctx.lineWidth = 2 / scale;
    ctx.beginPath();
    
    const cellWidth = (br.x - tl.x) / cols;
    const cellHeight = (br.y - tl.y) / rows;

    for (let i = 0; i <= rows; i++) {
      const y = tl.y + i * cellHeight;
      ctx.moveTo(tl.x, y);
      ctx.lineTo(br.x, y);
    }

    for (let j = 0; j <= cols; j++) {
      const x = tl.x + j * cellWidth;
      ctx.moveTo(x, tl.y);
      ctx.lineTo(x, br.y);
    }
    ctx.stroke();

    // Draw handles
    const handleRadius = 8 / scale;
    ctx.fillStyle = 'blue';
    ctx.beginPath();
    ctx.arc(tl.x, tl.y, handleRadius, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = 'red';
    ctx.beginPath();
    ctx.arc(br.x, br.y, handleRadius, 0, Math.PI * 2);
    ctx.fill();

    // Draw center handle for dragging
    ctx.fillStyle = 'rgba(0, 255, 0, 0.3)';
    ctx.beginPath();
    ctx.arc((tl.x + br.x) / 2, (tl.y + br.y) / 2, handleRadius * 1.5, 0, Math.PI * 2);
    ctx.fill();

  }, [image, tl, br, rows, cols, scale]);

  const getMousePos = (e: React.MouseEvent | React.TouchEvent) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }
    return {
      x: (clientX - rect.left) / scale,
      y: (clientY - rect.top) / scale,
    };
  };

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    const pos = getMousePos(e);
    const handleRadius = 20 / scale; // larger hit area
    
    const distTl = Math.hypot(pos.x - tl.x, pos.y - tl.y);
    const distBr = Math.hypot(pos.x - br.x, pos.y - br.y);
    
    // Check if clicking inside the grid for dragging
    const isInsideGrid = pos.x > tl.x && pos.x < br.x && pos.y > tl.y && pos.y < br.y;

    if (distTl < handleRadius) {
      setDragging('tl');
    } else if (distBr < handleRadius) {
      setDragging('br');
    } else if (isInsideGrid) {
      setDragging('all');
      setDragStart({ mouse: pos, tl: { ...tl }, br: { ...br } });
    }
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!dragging) return;
    const pos = getMousePos(e);
    
    if (dragging === 'tl') {
      const newX = Math.min(pos.x, br.x - 10);
      const width = br.x - newX;
      const cellWidth = width / cols;
      const height = cellWidth * rows;
      setTl({ x: newX, y: br.y - height });
    } else if (dragging === 'br') {
      const newX = Math.max(pos.x, tl.x + 10);
      const width = newX - tl.x;
      const cellWidth = width / cols;
      const height = cellWidth * rows;
      setBr({ x: newX, y: tl.y + height });
    } else if (dragging === 'all' && dragStart) {
      const dx = pos.x - dragStart.mouse.x;
      const dy = pos.y - dragStart.mouse.y;
      setTl({ x: dragStart.tl.x + dx, y: dragStart.tl.y + dy });
      setBr({ x: dragStart.br.x + dx, y: dragStart.br.y + dy });
    }
  };

  const handlePointerUp = () => {
    setDragging(null);
    setDragStart(null);
  };

  const handleRecognize = async () => {
    if (!image) return;
    setIsRecognizing(true);
    
    const cellWidth = (br.x - tl.x) / cols;
    const cellHeight = (br.y - tl.y) / rows;
    
    const cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cells.push({
          row: r,
          col: c,
          x: tl.x + c * cellWidth,
          y: tl.y + r * cellHeight,
          width: cellWidth,
          height: cellHeight
        });
      }
    }
    
    try {
      await onRecognize(cells, image, rows, cols);
    } finally {
      setIsRecognizing(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto">
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-wrap gap-4 items-end justify-between">
        <div className="flex gap-4 flex-wrap">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
              <Settings className="w-4 h-4" /> 行数 (Rows)
            </label>
            <input 
              type="number" 
              min="1" 
              value={rowsInput} 
              onChange={e => setRowsInput(e.target.value)}
              className="w-24 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
              <Settings className="w-4 h-4" /> 列数 (Cols)
            </label>
            <input 
              type="number" 
              min="1" 
              value={colsInput} 
              onChange={e => setColsInput(e.target.value)}
              className="w-24 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
        </div>
        
        <button 
          onClick={handleRecognize}
          disabled={isRecognizing || !image}
          className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors relative overflow-hidden"
        >
          {isRecognizing && progress !== undefined && progress !== null && (
            <div 
              className="absolute left-0 top-0 bottom-0 bg-blue-800 opacity-20 transition-all duration-300"
              style={{ width: `${progress * 100}%` }}
            />
          )}
          {isRecognizing ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin relative z-10" />
              <span className="relative z-10">
                {progress !== undefined && progress !== null 
                  ? `识别中 ${Math.round(progress * 100)}%` 
                  : '识别中...'}
              </span>
            </>
          ) : (
            <>
              <Check className="w-5 h-5 relative z-10" />
              <span className="relative z-10">识别色号</span>
            </>
          )}
        </button>
      </div>

      <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 overflow-hidden">
        <div 
          ref={containerRef}
          className="relative w-full overflow-auto flex justify-center items-start"
          style={{ maxHeight: '70vh' }}
        >
          <canvas
            ref={canvasRef}
            onMouseDown={handlePointerDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onMouseLeave={handlePointerUp}
            onTouchStart={handlePointerDown}
            onTouchMove={handlePointerMove}
            onTouchEnd={handlePointerUp}
            onTouchCancel={handlePointerUp}
            className={cn(
              "max-w-none h-auto shadow-md cursor-crosshair touch-none",
              dragging && "cursor-grabbing"
            )}
            style={{ 
              width: image ? `${image.width * scale}px` : 'auto',
              height: image ? `${image.height * scale}px` : 'auto'
            }}
          />
        </div>
      </div>
      <p className="text-sm text-gray-500 text-center">拖动蓝色（左上）和红色（右下）圆点来对齐网格</p>
    </div>
  );
}
