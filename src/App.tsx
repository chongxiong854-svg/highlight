import React, { useState, useEffect } from 'react';
import { ImageUploader } from './components/ImageUploader';
import { GridAligner } from './components/GridAligner';
import { PatternViewer } from './components/PatternViewer';
import { processGrid, ParsedCell, ColorGroup } from './lib/imageProcessor';
import { Palette, ArrowLeft, Clock, Trash2, Undo } from 'lucide-react';

type AppState = 'upload' | 'grid' | 'edit';

export interface SavedPattern {
  id: string;
  name: string;
  timestamp: number;
  rows: number;
  cols: number;
  cells: ParsedCell[];
  groups: ColorGroup[];
}

export default function App() {
  const [appState, setAppState] = useState<AppState>('upload');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [cells, setCells] = useState<ParsedCell[]>([]);
  const [groups, setGroups] = useState<ColorGroup[]>([]);
  const [rows, setRows] = useState(0);
  const [cols, setCols] = useState(0);
  const [savedPatterns, setSavedPatterns] = useState<SavedPattern[]>([]);
  const [canUndoToViewer, setCanUndoToViewer] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('pattern_history');
    if (saved) {
      try {
        setSavedPatterns(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse saved patterns', e);
      }
    }
  }, []);

  const handleImageLoad = (url: string) => {
    setImageUrl(url);
    setAppState('grid');
    setCanUndoToViewer(false);
  };

  const [progress, setProgress] = useState<number | null>(null);

  const handleRecognize = async (
    rawCells: { x: number; y: number; width: number; height: number; row: number; col: number }[],
    imageElement: HTMLImageElement,
    r: number,
    c: number
  ) => {
    try {
      setProgress(0);
      const { parsedCells, groups } = await processGrid(rawCells, imageElement, r, c, (p) => setProgress(p));
      setCells(parsedCells);
      setGroups(groups);
      setRows(r);
      setCols(c);
      setAppState('edit');
    } catch (error) {
      console.error('Failed to process grid:', error);
      alert('识别失败，请重试');
    } finally {
      setProgress(null);
    }
  };

  const handleUpdateCells = (newCells: ParsedCell[], newGroups: ColorGroup[]) => {
    setCells(newCells);
    setGroups(newGroups);
  };

  const handleSavePattern = (name: string, overwriteId?: string) => {
    let updated: SavedPattern[];
    if (overwriteId) {
      updated = savedPatterns.map(p => {
        if (p.id === overwriteId) {
          return { ...p, timestamp: Date.now(), rows, cols, cells, groups };
        }
        return p;
      });
      const overwritten = updated.find(p => p.id === overwriteId);
      if (overwritten) {
        updated = [overwritten, ...updated.filter(p => p.id !== overwriteId)];
      }
    } else {
      const newPattern: SavedPattern = {
        id: Date.now().toString(),
        name,
        timestamp: Date.now(),
        rows,
        cols,
        cells,
        groups
      };
      updated = [newPattern, ...savedPatterns];
    }

    try {
      localStorage.setItem('pattern_history', JSON.stringify(updated));
      setSavedPatterns(updated);
    } catch (e) {
      console.error("Failed to save pattern", e);
      throw new Error("Save failed");
    }
  };

  const handleLoadPattern = (pattern: SavedPattern) => {
    setCells(pattern.cells);
    setGroups(pattern.groups);
    setRows(pattern.rows);
    setCols(pattern.cols);
    setAppState('edit');
  };

  const handleDeletePattern = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = savedPatterns.filter(p => p.id !== id);
    setSavedPatterns(updated);
    localStorage.setItem('pattern_history', JSON.stringify(updated));
  };

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900 font-sans p-4 sm:p-8">
      <header className="max-w-6xl mx-auto mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center shadow-md">
            <Palette className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">拼豆辅助工具</h1>
        </div>
        
        {appState === 'upload' && canUndoToViewer && (
          <button
            onClick={() => {
              setAppState('edit');
              setCanUndoToViewer(false);
            }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors shadow-sm"
          >
            <Undo className="w-4 h-4" /> 撤销
          </button>
        )}
        {appState !== 'upload' && (
          <button 
            onClick={() => {
              if (appState === 'edit') setAppState('grid');
              else if (appState === 'grid') {
                setAppState('upload');
                setImageUrl(null);
              }
            }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-md hover:bg-gray-50 transition-colors shadow-sm"
          >
            <ArrowLeft className="w-4 h-4" /> 返回上一步
          </button>
        )}
      </header>

      <main className="max-w-6xl mx-auto flex flex-col items-center justify-center min-h-[60vh]">
        {appState === 'upload' && (
          <div className="w-full max-w-2xl flex flex-col gap-8">
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
              <h2 className="text-xl font-semibold text-gray-800 mb-6 text-center">第一步：导入图纸</h2>
              <ImageUploader onImageLoad={handleImageLoad} />
            </div>

            {savedPatterns.length > 0 && (
              <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
                <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                  <Clock className="w-5 h-5" /> 历史记录
                </h3>
                <div className="space-y-3">
                  {savedPatterns.map(pattern => (
                    <div 
                      key={pattern.id} 
                      onClick={() => handleLoadPattern(pattern)}
                      className="flex items-center justify-between p-4 bg-gray-50 hover:bg-blue-50 cursor-pointer rounded-xl border border-gray-200 transition-colors"
                    >
                      <div>
                        <h4 className="font-medium text-gray-800">{pattern.name}</h4>
                        <p className="text-xs text-gray-500 mt-1">
                          {new Date(pattern.timestamp).toLocaleString()} · {pattern.cols}x{pattern.rows} 格
                        </p>
                      </div>
                      <button 
                        onClick={(e) => handleDeletePattern(pattern.id, e)}
                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="删除记录"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {appState === 'grid' && imageUrl && (
          <div className="w-full">
            <h2 className="text-xl font-semibold text-gray-800 mb-6 text-center">第二步：框选网格区域</h2>
            <GridAligner imageUrl={imageUrl} onRecognize={handleRecognize} progress={progress} />
          </div>
        )}

        {appState === 'edit' && (
          <div className="w-full">
            <PatternViewer 
              cells={cells} 
              groups={groups} 
              rows={rows} 
              cols={cols} 
              onUpdateCells={handleUpdateCells}
              onSave={handleSavePattern}
              savedPatterns={savedPatterns}
              onLoadPattern={handleLoadPattern}
              onDeletePattern={handleDeletePattern}
              onGoHome={() => {
                setAppState('upload');
                setCanUndoToViewer(true);
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
}
