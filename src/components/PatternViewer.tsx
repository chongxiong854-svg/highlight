import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Eye, EyeOff, Edit2, Check, X, Highlighter, Save, ZoomIn, ZoomOut, Clock, Trash2, Home, Undo, Pipette, Palette, Download, MoreHorizontal, ChevronDown } from 'lucide-react';
import * as htmlToImage from 'html-to-image';
import jsPDF from 'jspdf';
import { ParsedCell, ColorGroup } from '../lib/imageProcessor';
import { cn } from '../lib/utils';
import { SavedPattern } from '../App';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';

import { STANDARD_COLORS, findClosestColor } from '../lib/colorMap';

interface PatternViewerProps {
  cells: ParsedCell[];
  groups: ColorGroup[];
  rows: number;
  cols: number;
  onUpdateCells: (newCells: ParsedCell[], newGroups: ColorGroup[]) => void;
  onSave?: (name: string, overwriteId?: string) => void;
  savedPatterns?: SavedPattern[];
  onLoadPattern?: (pattern: SavedPattern) => void;
  onDeletePattern?: (id: string, e: React.MouseEvent) => void;
  onGoHome?: () => void;
}

export function PatternViewer({ cells, groups, rows, cols, onUpdateCells, onSave, savedPatterns, onLoadPattern, onDeletePattern, onGoHome }: PatternViewerProps) {
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [targetGroupId, setTargetGroupId] = useState<string>('');
  const [isMerging, setIsMerging] = useState(false);
  const [highlightMode, setHighlightMode] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [highlightedGroupIds, setHighlightedGroupIds] = useState<string[]>([]);
  const [pickerMode, setPickerMode] = useState(false);
  const [pickedColorInfo, setPickedColorInfo] = useState<{hex: string, code: string} | null>(null);
  const [editingGroup, setEditingGroup] = useState<{ groupId: string, currentCode: string, color: string } | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [history, setHistory] = useState<{cells: ParsedCell[], groups: ColorGroup[]}[]>([]);
  const [zoom, setZoom] = useState(1);
  const [showColorCode, setShowColorCode] = useState(true);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveMode, setSaveMode] = useState<'new' | 'overwrite'>('new');
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const [patternName, setPatternName] = useState('');
  const [toast, setToast] = useState<{message: string, type: 'success' | 'error'} | null>(null);
  
  const [recolorMode, setRecolorMode] = useState<'none' | 'select-source' | 'select-target'>('none');
  const [recolorSelectedCells, setRecolorSelectedCells] = useState<ParsedCell[]>([]);
  const [recolorTargetCell, setRecolorTargetCell] = useState<ParsedCell | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartCell, setDragStartCell] = useState<ParsedCell | null>(null);
  const [dragEndCell, setDragEndCell] = useState<ParsedCell | null>(null);
  const [showOtherMenu, setShowOtherMenu] = useState(false);
  const otherMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (otherMenuRef.current && !otherMenuRef.current.contains(event.target as Node)) {
        setShowOtherMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleHighlight = (groupId: string) => {
    setHighlightedGroupIds(prev => 
      prev.includes(groupId) ? prev.filter(id => id !== groupId) : [...prev, groupId]
    );
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const previousState = history[history.length - 1];
    setHistory(prev => prev.slice(0, -1));
    onUpdateCells(previousState.cells, previousState.groups);
  };

  const handleMerge = () => {
    if (selectedGroupIds.length === 0 || !targetGroupId) return;

    const targetGroup = groups.find(g => g.id === targetGroupId);
    if (!targetGroup) return;

    setHistory(prev => [...prev, { cells, groups }]);

    const newCells = cells.map(cell => {
      if (selectedGroupIds.includes(cell.groupId)) {
        return { ...cell, colorCode: targetGroup.code, color: targetGroup.color, groupId: targetGroup.id };
      }
      return cell;
    });

    const newGroupsMap = new Map<string, ColorGroup>();
    newCells.forEach(cell => {
      if (!newGroupsMap.has(cell.groupId)) {
        newGroupsMap.set(cell.groupId, { id: cell.groupId, code: cell.colorCode || '', count: 0, color: cell.color });
      }
      newGroupsMap.get(cell.groupId)!.count++;
    });

    const newGroups = Array.from(newGroupsMap.values()).sort((a, b) => b.count - a.count);

    onUpdateCells(newCells, newGroups);
    setSelectedGroupIds([]);
    setTargetGroupId('');
    setIsMerging(false);
  };

  const toggleSelection = (groupId: string) => {
    if (highlightMode) {
      toggleHighlight(groupId);
      return;
    }

    if (selectedGroupIds.includes(groupId)) {
      setSelectedGroupIds(selectedGroupIds.filter(id => id !== groupId));
    } else {
      setSelectedGroupIds([...selectedGroupIds, groupId]);
    }
  };

  const handleManualUpdate = () => {
    if (!editingGroup || !manualCode.trim()) return;

    const newCode = manualCode.trim().toUpperCase();
    const standardColor = STANDARD_COLORS.find(c => c.code === newCode);
    const newColor = standardColor ? standardColor.hex : editingGroup.color;
    const newGroupId = `G_${newCode}`;
    
    setHistory(prev => [...prev, { cells, groups }]);

    const newCells = cells.map(cell => {
      // Update all cells in the same group
      if (cell.groupId === editingGroup.groupId) {
        return { ...cell, colorCode: newCode, color: newColor, groupId: newGroupId };
      }
      return cell;
    });

    const newGroupsMap = new Map<string, ColorGroup>();
    newCells.forEach(cell => {
      if (!newGroupsMap.has(cell.groupId)) {
        newGroupsMap.set(cell.groupId, { id: cell.groupId, code: cell.colorCode || '', count: 0, color: cell.color });
      }
      newGroupsMap.get(cell.groupId)!.count++;
    });

    const newGroups = Array.from(newGroupsMap.values()).sort((a, b) => b.count - a.count);

    onUpdateCells(newCells, newGroups);
    setEditingGroup(null);
    setManualCode('');
  };

  const handleCellMouseDown = (cell: ParsedCell) => {
    if (recolorMode === 'select-source') {
      setIsDragging(true);
      setDragStartCell(cell);
      setDragEndCell(cell);
    }
  };

  const handleCellMouseEnter = (cell: ParsedCell) => {
    if (isDragging && recolorMode === 'select-source') {
      setDragEndCell(cell);
    }
  };

  useEffect(() => {
    const handleMouseUp = () => {
      if (isDragging && recolorMode === 'select-source' && dragStartCell && dragEndCell) {
        setIsDragging(false);
        
        const minRow = Math.min(dragStartCell.row, dragEndCell.row);
        const maxRow = Math.max(dragStartCell.row, dragEndCell.row);
        const minCol = Math.min(dragStartCell.col, dragEndCell.col);
        const maxCol = Math.max(dragStartCell.col, dragEndCell.col);

        if (minRow === maxRow && minCol === maxCol) {
          // Single click toggle
          const isSelected = recolorSelectedCells.some(s => s.row === minRow && s.col === minCol);
          if (isSelected) {
            setRecolorSelectedCells(recolorSelectedCells.filter(s => !(s.row === minRow && s.col === minCol)));
          } else {
            const cell = cells.find(cell => cell.row === minRow && cell.col === minCol);
            if (cell) setRecolorSelectedCells([...recolorSelectedCells, cell]);
          }
        } else {
          // Drag selection, add all
          const newSelected = [...recolorSelectedCells];
          for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
              const cell = cells.find(cell => cell.row === r && cell.col === c);
              if (cell && !newSelected.some(s => s.row === r && s.col === c)) {
                newSelected.push(cell);
              }
            }
          }
          setRecolorSelectedCells(newSelected);
        }
        setDragStartCell(null);
        setDragEndCell(null);
      }
    };

    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [isDragging, dragStartCell, dragEndCell, recolorSelectedCells, cells, recolorMode]);

  const handleExport = async (format: 'png' | 'pdf') => {
    if (!gridRef.current) return;
    setIsExporting(true);
    try {
      // Temporarily set zoom to 1 for high-quality export
      const originalZoom = zoom;
      setZoom(1);
      
      // Wait for React to re-render with zoom 1
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const canvas = await htmlToImage.toCanvas(gridRef.current, {
        pixelRatio: 2, // Higher resolution
        backgroundColor: '#ffffff'
      });
      
      setZoom(originalZoom);
      
      if (format === 'png') {
        const link = document.createElement('a');
        link.download = `pattern-${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
      } else if (format === 'pdf') {
        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF({
          orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
          unit: 'px',
          format: [canvas.width, canvas.height]
        });
        pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
        pdf.save(`pattern-${Date.now()}.pdf`);
      }
      
      setToast({ message: '导出成功！', type: 'success' });
      setShowExportModal(false);
    } catch (error) {
      console.error('Export failed:', error);
      setToast({ message: '导出失败，请重试', type: 'error' });
    } finally {
      setIsExporting(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  const handleCellClick = (cell: ParsedCell) => {
    if (recolorMode === 'select-target') {
      setRecolorTargetCell(cell);
      return;
    }
    if (recolorMode === 'select-source') {
      return; // Handled by mouse up
    }

    if (pickerMode) {
      const hex = cell.color.toLowerCase();
      let standardColor = STANDARD_COLORS.find(c => c.hex.toLowerCase() === hex);
      
      if (!standardColor) {
        standardColor = findClosestColor(hex);
      }
      
      setPickedColorInfo({ hex: standardColor.hex.toLowerCase(), code: standardColor.code });
      return;
    }

    if (editMode) {
      setEditingGroup({ groupId: cell.groupId, currentCode: cell.colorCode, color: cell.color });
      setManualCode(cell.colorCode || '');
      return;
    }

    if (highlightMode) {
      toggleHighlight(cell.groupId);
    } else {
      toggleSelection(cell.groupId);
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto">
      <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex-wrap gap-4">
        <div className="flex items-center gap-4 flex-wrap">
          <h2 className="text-xl font-semibold text-gray-800">图纸预览与编辑</h2>
          {onSave && (
            <button
              onClick={() => {
                setSaveMode('new');
                setShowSaveModal(true);
              }}
              className="flex items-center gap-2 px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-md hover:bg-green-100 transition-colors text-sm font-medium"
            >
              <Save className="w-4 h-4" />
              保存
            </button>
          )}
          <button
            onClick={() => setShowExportModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors text-sm font-medium"
          >
            <Download className="w-4 h-4" />
            导出
          </button>
          {savedPatterns && savedPatterns.length > 0 && (
            <button
              onClick={() => setShowHistoryModal(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors text-sm font-medium"
            >
              <Clock className="w-4 h-4" />
              历史记录
            </button>
          )}
          {onGoHome && (
            <button
              onClick={onGoHome}
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 text-gray-700 border border-gray-200 rounded-md hover:bg-gray-100 transition-colors text-sm font-medium"
            >
              <Home className="w-4 h-4" />
              首页
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-md border border-gray-200">
            <ZoomOut className="w-4 h-4 text-gray-500 cursor-pointer hover:text-gray-800" onClick={() => setZoom(z => Math.max(0.2, z - 0.01))} />
            <input 
              type="range" 
              min="0.2" 
              max="3" 
              step="0.01" 
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="w-20 h-1.5 bg-gray-300 rounded-lg appearance-none cursor-pointer"
            />
            <ZoomIn className="w-4 h-4 text-gray-500 cursor-pointer hover:text-gray-800" onClick={() => setZoom(z => Math.min(3, z + 0.01))} />
            <span className="text-xs text-gray-500 font-medium w-8 text-right">{Math.round(zoom * 100)}%</span>
          </div>
          {recolorMode !== 'none' && (
            <button
              onClick={() => {
                if (recolorMode === 'select-source') {
                  if (recolorSelectedCells.length === 0) {
                    setRecolorMode('none');
                  } else {
                    setRecolorMode('select-target');
                  }
                } else if (recolorMode === 'select-target') {
                  if (!recolorTargetCell) {
                    setToast({ message: '请先点击一个格子作为目标颜色', type: 'error' });
                    setTimeout(() => setToast(null), 3000);
                    return;
                  }
                  if (recolorTargetCell) {
                    // Apply recolor
                    const newCells = [...cells];
                    recolorSelectedCells.forEach(selectedCell => {
                      const cellIndex = newCells.findIndex(c => c.row === selectedCell.row && c.col === selectedCell.col);
                      if (cellIndex !== -1) {
                        newCells[cellIndex] = {
                          ...newCells[cellIndex],
                          color: recolorTargetCell.color,
                          colorCode: recolorTargetCell.colorCode,
                          groupId: recolorTargetCell.groupId
                        };
                      }
                    });

                    // Update groups
                    const newGroupsMap = new Map<string, ColorGroup>();
                    groups.forEach(g => newGroupsMap.set(g.id, { ...g, count: 0 }));
                    
                    newCells.forEach(cell => {
                      if (!newGroupsMap.has(cell.groupId)) {
                        newGroupsMap.set(cell.groupId, {
                          id: cell.groupId,
                          color: cell.color,
                          code: cell.colorCode,
                          count: 0
                        });
                      }
                      newGroupsMap.get(cell.groupId)!.count++;
                    });

                    const newGroups = Array.from(newGroupsMap.values())
                      .filter(g => g.count > 0)
                      .sort((a, b) => b.count - a.count);

                    onUpdateCells(newCells, newGroups);
                  }
                  setRecolorMode('none');
                  setRecolorSelectedCells([]);
                  setRecolorTargetCell(null);
                }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-purple-50 text-purple-700 border border-purple-200 rounded-md font-medium transition-colors"
            >
              <Palette className="w-5 h-5" />
              {recolorMode === 'select-source' ? '确认选中格子' : '确认目标颜色'}
            </button>
          )}
          <div className="relative" ref={otherMenuRef}>
            <button
              onClick={() => setShowOtherMenu(!showOtherMenu)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-colors border",
                (pickerMode || editMode || highlightMode || recolorMode !== 'none' || !showColorCode)
                  ? "bg-blue-50 text-blue-700 border-blue-200"
                  : "bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200"
              )}
            >
              <MoreHorizontal className="w-5 h-5" />
              其它
              <ChevronDown className="w-4 h-4" />
            </button>
            
            {showOtherMenu && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-2 z-50 flex flex-col">
                <button
                  onClick={() => {
                    setPickerMode(!pickerMode);
                    if (!pickerMode) {
                      setEditMode(false);
                      setHighlightMode(false);
                      setHighlightedGroupIds([]);
                      setSelectedGroupIds([]);
                      setEditingGroup(null);
                      setPickedColorInfo(null);
                      setRecolorMode('none');
                    } else {
                      setPickedColorInfo(null);
                    }
                    setShowOtherMenu(false);
                  }}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2 text-sm hover:bg-gray-50 text-left",
                    pickerMode ? "text-purple-600 font-medium bg-purple-50/50" : "text-gray-700"
                  )}
                >
                  <Pipette className="w-4 h-4" />
                  取色器
                </button>
                <button
                  onClick={() => {
                    setEditMode(!editMode);
                    if (!editMode) {
                      setPickerMode(false);
                      setPickedColorInfo(null);
                      setHighlightMode(false);
                      setHighlightedGroupIds([]);
                      setSelectedGroupIds([]);
                      setRecolorMode('none');
                    } else {
                      setEditingGroup(null);
                    }
                    setShowOtherMenu(false);
                  }}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2 text-sm hover:bg-gray-50 text-left",
                    editMode ? "text-blue-600 font-medium bg-blue-50/50" : "text-gray-700"
                  )}
                >
                  <Edit2 className="w-4 h-4" />
                  手动填入色号
                </button>
                <button
                  onClick={() => {
                    setHighlightMode(!highlightMode);
                    if (!highlightMode) {
                      setPickerMode(false);
                      setPickedColorInfo(null);
                      setEditMode(false);
                      setEditingGroup(null);
                      setHighlightedGroupIds([]);
                      setSelectedGroupIds([]);
                      setRecolorMode('none');
                    }
                    setShowOtherMenu(false);
                  }}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2 text-sm hover:bg-gray-50 text-left",
                    highlightMode ? "text-yellow-600 font-medium bg-yellow-50/50" : "text-gray-700"
                  )}
                >
                  <Highlighter className="w-4 h-4" />
                  高亮色号
                </button>
                {recolorMode === 'none' && (
                  <button
                    onClick={() => {
                      setRecolorMode('select-source');
                      setRecolorSelectedCells([]);
                      setRecolorTargetCell(null);
                      setPickerMode(false);
                      setEditMode(false);
                      setHighlightMode(false);
                      setHighlightedGroupIds([]);
                      setSelectedGroupIds([]);
                      setShowOtherMenu(false);
                    }}
                    className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-gray-50 text-left text-gray-700"
                  >
                    <Palette className="w-4 h-4" />
                    改色
                  </button>
                )}
                <div className="h-px bg-gray-100 my-1"></div>
                <button
                  onClick={() => {
                    setShowColorCode(!showColorCode);
                    setShowOtherMenu(false);
                  }}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2 text-sm hover:bg-gray-50 text-left",
                    !showColorCode ? "text-blue-600 font-medium bg-blue-50/50" : "text-gray-700"
                  )}
                >
                  {showColorCode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  {showColorCode ? '不显示色号' : '显示色号'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {showExportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">导出图纸</h3>
              <button onClick={() => setShowExportModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => handleExport('png')}
                disabled={isExporting}
                className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {isExporting ? '导出中...' : '导出为 PNG 图片'}
              </button>
              <button 
                onClick={() => handleExport('pdf')}
                disabled={isExporting}
                className="w-full py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {isExporting ? '导出中...' : '导出为 PDF 文件'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSaveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">保存图纸</h3>
              <button onClick={() => setShowSaveModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex gap-4 mb-4 border-b pb-2">
              <button
                className={cn("pb-2 px-2 font-medium border-b-2 transition-colors text-sm", saveMode === 'new' ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700")}
                onClick={() => setSaveMode('new')}
              >
                新建保存
              </button>
              {savedPatterns && savedPatterns.length > 0 && (
                <button
                  className={cn("pb-2 px-2 font-medium border-b-2 transition-colors text-sm", saveMode === 'overwrite' ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700")}
                  onClick={() => setSaveMode('overwrite')}
                >
                  覆盖已有
                </button>
              )}
            </div>

            {saveMode === 'new' ? (
              <>
                <input
                  type="text"
                  autoFocus
                  value={patternName}
                  onChange={e => setPatternName(e.target.value)}
                  placeholder="给这份图纸起个名字..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none mb-6"
                />
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setShowSaveModal(false)}
                    className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => {
                      if (patternName.trim() && onSave) {
                        try {
                          onSave(patternName.trim());
                          setShowSaveModal(false);
                          setPatternName('');
                          setToast({ message: '保存成功', type: 'success' });
                          setTimeout(() => setToast(null), 1000);
                        } catch (e) {
                          setToast({ message: '保存失败', type: 'error' });
                          setTimeout(() => setToast(null), 1000);
                        }
                      }
                    }}
                    disabled={!patternName.trim()}
                    className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors"
                  >
                    确定保存
                  </button>
                </div>
              </>
            ) : (
              <div className="max-h-[40vh] overflow-y-auto space-y-2 mb-2 pr-2">
                {savedPatterns?.map(pattern => (
                  <div
                    key={pattern.id}
                    onClick={() => {
                      if (onSave) {
                        try {
                          onSave(pattern.name, pattern.id);
                          setShowSaveModal(false);
                          setToast({ message: '覆盖成功', type: 'success' });
                          setTimeout(() => setToast(null), 1000);
                        } catch (e) {
                          setToast({ message: '覆盖失败', type: 'error' });
                          setTimeout(() => setToast(null), 1000);
                        }
                      }
                    }}
                    className="flex items-center justify-between p-3 bg-gray-50 hover:bg-blue-50 cursor-pointer rounded-lg border border-gray-200 transition-colors"
                  >
                    <div>
                      <h4 className="font-medium text-gray-800 text-sm">{pattern.name}</h4>
                      <p className="text-xs text-gray-500 mt-1">
                        {new Date(pattern.timestamp).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed inset-0 flex items-center justify-center z-[100] pointer-events-none">
          <div className={cn(
            "px-6 py-3 rounded-lg shadow-lg text-white font-medium transition-all transform scale-100 animate-in fade-in zoom-in duration-200",
            toast.type === 'success' ? "bg-green-500" : "bg-red-500"
          )}>
            {toast.message}
          </div>
        </div>
      )}

      {showHistoryModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Clock className="w-5 h-5" /> 历史记录
              </h3>
              <button onClick={() => setShowHistoryModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 space-y-3 pr-2">
              {savedPatterns?.map(pattern => (
                <div 
                  key={pattern.id} 
                  onClick={() => {
                    if (onLoadPattern) onLoadPattern(pattern);
                    setShowHistoryModal(false);
                  }}
                  className="flex items-center justify-between p-4 bg-gray-50 hover:bg-blue-50 cursor-pointer rounded-xl border border-gray-200 transition-colors"
                >
                  <div>
                    <h4 className="font-medium text-gray-800">{pattern.name}</h4>
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(pattern.timestamp).toLocaleString()} · {pattern.cols}x{pattern.rows} 格
                    </p>
                  </div>
                  <button 
                    onClick={(e) => {
                      if (onDeletePattern) onDeletePattern(pattern.id, e);
                    }}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="删除记录"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {pickerMode && (
        <div className="w-full p-4 bg-purple-50 border border-purple-200 rounded-xl shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Pipette className="w-5 h-5 text-purple-600" />
            <span className="text-purple-800 font-medium">
              {pickedColorInfo ? '取色结果：' : '请点击图纸中的颜色进行取色'}
            </span>
            {pickedColorInfo && (
              <div className="flex items-center gap-2 ml-2">
                <div 
                  className="w-6 h-6 rounded-md shadow-sm border border-gray-200" 
                  style={{ backgroundColor: pickedColorInfo.hex }}
                />
                <span className="font-bold text-lg text-purple-900">{pickedColorInfo.code}</span>
                <span className="text-sm text-purple-600 ml-1">({pickedColorInfo.hex.toUpperCase()})</span>
              </div>
            )}
          </div>
          {pickedColorInfo && (
            <button 
              onClick={() => setPickedColorInfo(null)}
              className="text-sm text-purple-600 hover:text-purple-800 underline"
            >
              清除
            </button>
          )}
        </div>
      )}

      {recolorMode !== 'none' && (
        <div className="w-full p-4 bg-purple-50 border border-purple-200 rounded-xl shadow-sm">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold text-purple-800 flex items-center gap-2">
              <Palette className="w-4 h-4" /> 
              {recolorMode === 'select-source' 
                ? '第 1 步：点击或框选要改色的格子，然后点击“确认选中格子”' 
                : '第 2 步：点击一个格子作为目标颜色，然后点击“确认目标颜色”'}
            </h3>
            <button 
              onClick={() => {
                setRecolorMode('none');
                setRecolorSelectedCells([]);
                setRecolorTargetCell(null);
              }}
              className="text-xs text-purple-700 hover:text-purple-900 underline"
            >
              取消改色
            </button>
          </div>
          {recolorMode === 'select-source' && recolorSelectedCells.length > 0 && (
            <p className="text-xs text-purple-600">已选中 {recolorSelectedCells.length} 个格子</p>
          )}
          {recolorMode === 'select-target' && recolorTargetCell && (
            <div className="flex items-center gap-2 text-xs text-purple-600">
              已选目标颜色: 
              <div className="w-4 h-4 rounded-full border border-black/10" style={{ backgroundColor: recolorTargetCell.color }} />
              <span className="font-medium">{recolorTargetCell.colorCode}</span>
            </div>
          )}
        </div>
      )}

      {highlightMode && (
        <div className="w-full p-4 bg-yellow-50 border border-yellow-200 rounded-xl shadow-sm">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold text-yellow-800 flex items-center gap-2">
              <Highlighter className="w-4 h-4" /> 选择要高亮的色号 (可多选)
            </h3>
            {highlightedGroupIds.length > 0 && (
              <button 
                onClick={() => setHighlightedGroupIds([])}
                className="text-xs text-yellow-700 hover:text-yellow-900 underline"
              >
                清除所有高亮
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {groups.map(g => (
              <button
                key={g.id}
                onClick={() => toggleHighlight(g.id)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors flex items-center gap-2",
                  highlightedGroupIds.includes(g.id) 
                    ? "bg-yellow-400 border-yellow-500 text-yellow-900 shadow-sm" 
                    : "bg-white border-yellow-300 text-yellow-700 hover:bg-yellow-100"
                )}
              >
                <div 
                  className="w-3 h-3 rounded-full border border-black/10"
                  style={{ backgroundColor: g.color }}
                />
                {g.code || '未分配'}
              </button>
            ))}
          </div>
        </div>
      )}

      {editingGroup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-semibold mb-4">手动填入色号</h3>
            <p className="text-sm text-gray-500 mb-4">
              正在编辑色号组: <span className="font-bold text-gray-800">{editingGroup.currentCode || '未分配'}</span>
            </p>
            <input
              type="text"
              autoFocus
              value={manualCode}
              onChange={e => setManualCode(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleManualUpdate()}
              placeholder="例如: A1, B12"
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none mb-6"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setEditingGroup(null)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleManualUpdate}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-6">
        {/* Grid View */}
        <div className="w-full bg-gray-50 p-4 rounded-xl border border-gray-200 overflow-hidden flex justify-center items-start relative h-[170vh]">
          <TransformWrapper
            initialScale={1}
            minScale={0.1}
            maxScale={5}
            centerOnInit
            wheel={{ step: 0.1 }}
          >
            <TransformComponent wrapperStyle={{ width: "100%", height: "100%" }}>
              <div 
                ref={gridRef}
                className={cn(
                  "flex flex-col items-center",
                  isExporting ? "bg-white p-8 rounded-xl" : ""
                )}
                style={{ width: 'fit-content' }}
              >
                <div className="flex flex-col">
                  {/* Column numbers */}
                  <div className="flex">
                    <div style={{ width: `${24 * zoom}px`, border: '1px solid transparent' }} className="shrink-0"></div>
                    <div 
                      className="grid border border-transparent" 
                      style={{ 
                        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                        width: 'fit-content',
                        gap: !showColorCode ? '0.25px' : '1px'
                      }}
                    >
                      {Array.from({ length: cols }).map((_, i) => (
                        <div 
                          key={`col-${i}`} 
                          className="flex items-center justify-center text-gray-500 font-medium"
                          style={{ width: `${28 * zoom}px`, height: `${24 * zoom}px`, fontSize: `${12 * zoom}px` }}
                        >
                          {i + 1}
                        </div>
                      ))}
                    </div>
                    <div style={{ width: `${24 * zoom}px`, border: '1px solid transparent' }} className="shrink-0"></div>
                  </div>
                  <div className="flex">
                    {/* Row numbers */}
                    <div 
                      className="grid border border-transparent"
                      style={{
                        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
                        height: 'fit-content',
                        gap: !showColorCode ? '0.25px' : '1px'
                      }}
                    >
                      {Array.from({ length: rows }).map((_, i) => (
                        <div 
                          key={`row-${i}`} 
                          className="flex items-center justify-center text-gray-500 font-medium"
                          style={{ width: `${24 * zoom}px`, height: `${28 * zoom}px`, fontSize: `${12 * zoom}px` }}
                        >
                          {i + 1}
                        </div>
                      ))}
                    </div>
                    {/* Grid */}
                    <div 
                      className="grid bg-gray-300 border border-gray-400 select-none"
                      style={{ 
                        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                        width: 'fit-content',
                        gap: !showColorCode ? '0.25px' : '1px'
                      }}
                    >
                      {cells.map((cell, i) => {
                        const isHighlighted = highlightMode && highlightedGroupIds.includes(cell.groupId);
                        const isSelected = !highlightMode && selectedGroupIds.includes(cell.groupId);
                        const isRecolorSelected = recolorSelectedCells.some(c => c.row === cell.row && c.col === cell.col);
                        const isRecolorTarget = recolorTargetCell?.row === cell.row && recolorTargetCell?.col === cell.col;
                        
                        let isDragHovered = false;
                        if (isDragging && dragStartCell && dragEndCell) {
                          const minRow = Math.min(dragStartCell.row, dragEndCell.row);
                          const maxRow = Math.max(dragStartCell.row, dragEndCell.row);
                          const minCol = Math.min(dragStartCell.col, dragEndCell.col);
                          const maxCol = Math.max(dragStartCell.col, dragEndCell.col);
                          isDragHovered = cell.row >= minRow && cell.row <= maxRow && cell.col >= minCol && cell.col <= maxCol;
                        }

                        const isDimmed = 
                          (highlightMode && highlightedGroupIds.length > 0 && !highlightedGroupIds.includes(cell.groupId)) ||
                          (!highlightMode && selectedGroupIds.length > 0 && !selectedGroupIds.includes(cell.groupId));

                        return (
                          <div
                            key={i}
                            onMouseDown={() => handleCellMouseDown(cell)}
                            onMouseEnter={() => handleCellMouseEnter(cell)}
                            onClick={() => handleCellClick(cell)}
                            className={cn(
                              "relative flex items-center justify-center font-bold transition-all duration-200",
                              pickerMode ? "cursor-crosshair" : "cursor-pointer",
                              (isHighlighted || isSelected) && "z-10 scale-110 shadow-md ring-[4px] ring-yellow-400 ring-inset",
                              (isRecolorSelected || isDragHovered) && "z-10 scale-110 shadow-md ring-[4px] ring-purple-400 ring-inset",
                              isRecolorTarget && "z-20 scale-125 shadow-lg ring-[4px] ring-green-500 ring-inset"
                            )}
                            style={{ 
                              width: `${28 * zoom}px`,
                              height: `${28 * zoom}px`,
                              fontSize: `${(28 * zoom) * 0.316}px`,
                              backgroundColor: cell.color,
                              color: getContrastYIQ(cell.color), // Ensure text is readable
                            }}
                            title={`Row: ${cell.row + 1}, Col: ${cell.col + 1} - Code: ${cell.colorCode}`}
                          >
                            {showColorCode && <span className="relative z-10">{cell.colorCode}</span>}
                            {isDimmed && <div className="absolute inset-0 bg-black/65 pointer-events-none z-20"></div>}
                            {(isHighlighted || isSelected) && (
                              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                                <div className="w-1/3 h-1/3 rounded-full border-[3px] border-yellow-400"></div>
                              </div>
                            )}
                            {(isRecolorSelected || isDragHovered) && (
                              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                                <div className="w-1/3 h-1/3 rounded-full border-[3px] border-purple-400 bg-purple-400/20"></div>
                              </div>
                            )}
                            {isRecolorTarget && (
                              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                                <div className="w-1/3 h-1/3 rounded-full border-[3px] border-green-500 bg-green-500/20"></div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {/* Right Row numbers */}
                    <div 
                      className="grid border border-transparent"
                      style={{
                        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
                        height: 'fit-content',
                        gap: !showColorCode ? '0.25px' : '1px'
                      }}
                    >
                      {Array.from({ length: rows }).map((_, i) => (
                        <div 
                          key={`row-right-${i}`} 
                          className="flex items-center justify-center text-gray-500 font-medium"
                          style={{ width: `${24 * zoom}px`, height: `${28 * zoom}px`, fontSize: `${12 * zoom}px` }}
                        >
                          {i + 1}
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Bottom Column numbers */}
                  <div className="flex">
                    <div style={{ width: `${24 * zoom}px`, border: '1px solid transparent' }} className="shrink-0"></div>
                    <div 
                      className="grid border border-transparent" 
                      style={{ 
                        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                        width: 'fit-content',
                        gap: !showColorCode ? '0.25px' : '1px'
                      }}
                    >
                      {Array.from({ length: cols }).map((_, i) => (
                        <div 
                          key={`col-bottom-${i}`} 
                          className="flex items-center justify-center text-gray-500 font-medium"
                          style={{ width: `${28 * zoom}px`, height: `${24 * zoom}px`, fontSize: `${12 * zoom}px` }}
                        >
                          {i + 1}
                        </div>
                      ))}
                    </div>
                    <div style={{ width: `${24 * zoom}px`, border: '1px solid transparent' }} className="shrink-0"></div>
                  </div>
                </div>
                
                {/* Color Stats for Export */}
                {isExporting && (
                  <div className="w-full mt-8 pt-6 border-t border-gray-200 max-w-4xl">
                    <h3 className="text-2xl font-bold text-gray-800 mb-6 text-center">色号统计</h3>
                    <div className="flex flex-wrap justify-center gap-4">
                      {groups.map((group) => (
                        <div key={group.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 bg-gray-50 shadow-sm">
                          <div 
                            className="w-8 h-8 rounded-full border-2 border-gray-300 shadow-sm shrink-0"
                            style={{ backgroundColor: group.color }}
                          />
                          <span className="font-bold text-gray-800 text-lg">{group.code || '未分配'}</span>
                          <span className="text-sm font-bold text-gray-600 bg-gray-200 px-2.5 py-1 rounded-full shrink-0">
                            × {group.count}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </TransformComponent>
          </TransformWrapper>
        </div>

        {/* Bottom Panel */}
        <div className="w-full flex flex-col gap-4">
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                <Edit2 className="w-5 h-5" /> 色号统计与合并
              </h3>
            </div>
            
            {!highlightMode && selectedGroupIds.length > 0 && (
              <div className="mb-6 p-4 bg-blue-50 border border-blue-100 rounded-lg flex flex-col sm:flex-row items-center gap-4">
                <p className="text-sm text-blue-800 font-medium whitespace-nowrap">已选择 {selectedGroupIds.length} 个色号</p>
                <div className="flex-1 flex gap-2 w-full">
                  <select 
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none"
                    value={targetGroupId}
                    onChange={(e) => setTargetGroupId(e.target.value)}
                  >
                    <option value="">-- 选择目标色号 --</option>
                    {groups.map(g => (
                      <option key={g.id} value={g.id}>{g.code || '未分配'} (数量: {g.count})</option>
                    ))}
                  </select>
                  <button
                    onClick={handleMerge}
                    disabled={!targetGroupId}
                    className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    合并色号
                  </button>
                  <button
                    onClick={handleUndo}
                    disabled={history.length === 0}
                    className="px-4 py-2 bg-white text-gray-700 border border-gray-300 text-sm font-medium rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors whitespace-nowrap flex items-center gap-1"
                    title="撤销上一步操作"
                  >
                    <Undo className="w-4 h-4" /> 撤销
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {groups.map((group) => {
                const isSelected = selectedGroupIds.includes(group.id);
                const isHighlighted = highlightMode && highlightedGroupIds.includes(group.id);

                return (
                  <div 
                    key={group.id}
                    onClick={() => {
                      if (editMode) {
                        setEditingGroup({ groupId: group.id, currentCode: group.code, color: group.color });
                        setManualCode(group.code || '');
                      } else if (highlightMode) {
                        toggleHighlight(group.id);
                      } else {
                        toggleSelection(group.id);
                      }
                    }}
                    className={cn(
                      "flex items-center justify-between p-2 rounded-lg border cursor-pointer transition-colors",
                      isSelected ? "bg-blue-50 border-blue-200" : "bg-white border-gray-100 hover:bg-gray-50",
                      isHighlighted && "bg-yellow-50 border-yellow-300 ring-1 ring-yellow-400",
                      editMode && "hover:bg-blue-50 hover:border-blue-300 border-dashed"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-5 h-5 rounded-full border border-gray-200 shadow-sm shrink-0"
                        style={{ backgroundColor: group.color }}
                      />
                      <span className="font-medium text-gray-700 text-sm truncate">{group.code || '未分配'}</span>
                    </div>
                    <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full shrink-0">
                      {group.count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper to determine text color based on background brightness
function getContrastYIQ(hexcolor: string){
  hexcolor = hexcolor.replace("#", "");
  var r = parseInt(hexcolor.substr(0,2),16);
  var g = parseInt(hexcolor.substr(2,2),16);
  var b = parseInt(hexcolor.substr(4,2),16);
  var yiq = ((r*299)+(g*587)+(b*114))/1000;
  return (yiq >= 128) ? 'black' : 'white';
}

