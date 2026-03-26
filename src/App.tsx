import React, { useState, useEffect } from 'react';
import { ImageUploader } from './components/ImageUploader';
import { GridAligner } from './components/GridAligner';
import { PatternViewer } from './components/PatternViewer';
import { processGrid, ParsedCell, ColorGroup } from './lib/imageProcessor';
import { Palette, ArrowLeft, Clock, Trash2, Undo, Edit2, LogIn, X, Copy } from 'lucide-react';
import { auth, db, signInWithGoogle } from './firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, setDoc, deleteDoc, getDoc } from 'firebase/firestore';

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
  
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [importCode, setImportCode] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  // Modal states
  const [renameModal, setRenameModal] = useState<{ id: string, name: string } | null>(null);
  const [copyModal, setCopyModal] = useState<{ id: string } | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('pattern_history');
    if (saved) {
      try {
        setSavedPatterns(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse saved patterns', e);
      }
    } else {
      setSavedPatterns([]);
    }
  }, []);

  const handleRenamePattern = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const pattern = savedPatterns.find(p => p.id === id);
    if (!pattern) return;
    setRenameInput(pattern.name);
    setRenameModal({ id, name: pattern.name });
  };

  const confirmRename = async () => {
    if (renameModal && renameInput.trim() !== '') {
      const newName = renameInput.trim();
      
      const updated = savedPatterns.map(p => p.id === renameModal.id ? { ...p, name: newName } : p);
      setSavedPatterns(updated);
      localStorage.setItem('pattern_history', JSON.stringify(updated));

      try {
        const patternRef = doc(db, `patterns`, renameModal.id);
        await setDoc(patternRef, { name: newName }, { merge: true });
      } catch (error) {
        console.error("Failed to rename pattern in Firestore", error);
      }
      
      setRenameModal(null);
    }
  };

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
      setAlertMessage('识别失败，请重试');
    } finally {
      setProgress(null);
    }
  };

  const handleUpdateCells = (newCells: ParsedCell[], newGroups: ColorGroup[]) => {
    setCells(newCells);
    setGroups(newGroups);
  };

  const handleSavePattern = async (name: string, overwriteId?: string) => {
    const timestamp = Date.now();
    // Generate a random 6-character alphanumeric identity code
    const id = overwriteId || Math.random().toString(36).substring(2, 8).toUpperCase();
    
    const newPattern: SavedPattern = {
      id,
      name,
      timestamp,
      rows,
      cols,
      cells,
      groups
    };

    let updated: SavedPattern[];
    if (overwriteId) {
      updated = savedPatterns.map(p => {
        if (p.id === overwriteId) {
          return newPattern;
        }
        return p;
      });
      const overwritten = updated.find(p => p.id === overwriteId);
      if (overwritten) {
        updated = [overwritten, ...updated.filter(p => p.id !== overwriteId)];
      }
    } else {
      updated = [newPattern, ...savedPatterns];
    }

    try {
      localStorage.setItem('pattern_history', JSON.stringify(updated));
      setSavedPatterns(updated);
    } catch (e) {
      console.error("Failed to save pattern locally", e);
      setAlertMessage('本地保存失败，可能是存储空间不足');
      throw new Error("Save failed");
    }

    try {
      const patternRef = doc(db, `patterns`, id);
      await setDoc(patternRef, {
        id,
        name,
        timestamp,
        rows,
        cols,
        cells: JSON.stringify(cells),
        groups: JSON.stringify(groups)
      });
      if (!overwriteId) {
        setAlertMessage(`保存成功！您的图纸身份码为：${id}`);
      }
    } catch (error) {
      console.error("Failed to save pattern to Firestore", error);
      setAlertMessage('云端保存失败，但已保存在本地。');
    }
  };

  const handleLoadPattern = (pattern: SavedPattern) => {
    setCells(pattern.cells);
    setGroups(pattern.groups);
    setRows(pattern.rows);
    setCols(pattern.cols);
    setAppState('edit');
  };

  const handleDeletePattern = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = savedPatterns.filter(p => p.id !== id);
    setSavedPatterns(updated);
    localStorage.setItem('pattern_history', JSON.stringify(updated));

    try {
      await deleteDoc(doc(db, `patterns`, id));
    } catch (error) {
      console.error("Failed to delete pattern from Firestore", error);
    }
  };

  const handleImportPattern = async () => {
    if (!importCode.trim()) return;
    setIsImporting(true);
    try {
      const patternRef = doc(db, `patterns`, importCode.trim().toUpperCase());
      const docSnap = await getDoc(patternRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        const importedPattern: SavedPattern = {
          id: data.id,
          name: data.name,
          timestamp: data.timestamp,
          rows: data.rows,
          cols: data.cols,
          cells: JSON.parse(data.cells),
          groups: JSON.parse(data.groups)
        };
        handleLoadPattern(importedPattern);
        
        // Add to local history if not already there
        if (!savedPatterns.some(p => p.id === importedPattern.id)) {
          const updated = [importedPattern, ...savedPatterns];
          setSavedPatterns(updated);
          localStorage.setItem('pattern_history', JSON.stringify(updated));
        }
      } else {
        setAlertMessage('该身份码不存在，请检查后重试。');
      }
    } catch (error) {
      console.error("Failed to import pattern", error);
      setAlertMessage('导入失败，请检查网络后重试。');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900 font-sans p-4 sm:p-8">
      <header className="max-w-6xl mx-auto mb-8 flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center shadow-md shrink-0">
            <Palette className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800 tracking-tight">拼豆辅助工具</h1>
        </div>
        
        <div className="flex items-center gap-3 flex-wrap">
          {!user ? (
            <button
              onClick={signInWithGoogle}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors shadow-sm"
            >
              <LogIn className="w-4 h-4" /> 登录以同步图纸
            </button>
          ) : (
            <button
              onClick={() => signOut(auth)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-md hover:bg-gray-50 transition-colors shadow-sm"
              title={user.email}
            >
              <img src={user.photoURL || ''} alt="avatar" className="w-5 h-5 rounded-full" />
              退出登录
            </button>
          )}
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
        </div>
      </header>

      <main className="max-w-6xl mx-auto flex flex-col items-center justify-center min-h-[60vh]">
        {appState === 'upload' && (
          <div className="w-full max-w-2xl flex flex-col gap-8">
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
              <h2 className="text-xl font-semibold text-gray-800 mb-6 text-center">已有图纸导入</h2>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={importCode}
                  onChange={(e) => setImportCode(e.target.value)}
                  placeholder="请输入图纸身份码"
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleImportPattern();
                  }}
                />
                <button
                  onClick={handleImportPattern}
                  disabled={!importCode.trim() || isImporting}
                  className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
                >
                  {isImporting ? '导入中...' : '导入'}
                </button>
              </div>
            </div>

            <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
              <h2 className="text-xl font-semibold text-gray-800 mb-6 text-center">第一步：导入新图纸</h2>
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
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setCopyModal({ id: pattern.id });
                          }}
                          className="p-2 text-gray-400 hover:text-green-500 hover:bg-green-100 rounded-lg transition-colors"
                          title="复制身份码"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={(e) => handleRenamePattern(pattern.id, e)}
                          className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-100 rounded-lg transition-colors"
                          title="重命名记录"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={(e) => handleDeletePattern(pattern.id, e)}
                          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="删除记录"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
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

      {/* Rename Modal */}
      {renameModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">重命名图纸</h3>
              <button onClick={() => setRenameModal(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">新名称</label>
              <input
                type="text"
                value={renameInput}
                onChange={(e) => setRenameInput(e.target.value)}
                placeholder="请输入新的名称"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmRename();
                }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRenameModal(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
              >
                取消
              </button>
              <button
                onClick={confirmRename}
                disabled={!renameInput.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Copy Modal */}
      {copyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-800">复制身份码</h3>
              <button onClick={() => setCopyModal(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mb-6">
              <p className="text-sm text-gray-600 mb-2">图纸身份码：</p>
              <div className="bg-gray-100 p-3 rounded-lg text-center font-mono text-xl font-bold tracking-wider text-gray-800">
                {copyModal.id}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCopyModal(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
              >
                取消
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(copyModal.id);
                  setCopyModal(null);
                  setToastMessage('复制成功！');
                  setTimeout(() => setToastMessage(null), 1000);
                }}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700"
              >
                <Copy className="w-4 h-4" /> 确认复制
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Message */}
      {toastMessage && (
        <div className="fixed top-10 left-1/2 transform -translate-x-1/2 z-[60] bg-gray-800 text-white px-6 py-3 rounded-full shadow-lg transition-opacity duration-300">
          {toastMessage}
        </div>
      )}

      {/* Alert Modal */}
      {alertMessage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-red-600">提示</h3>
              <button onClick={() => setAlertMessage(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-gray-700 mb-6">{alertMessage}</p>
            <div className="flex justify-end">
              <button
                onClick={() => setAlertMessage(null)}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
