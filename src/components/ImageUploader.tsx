import React, { useCallback } from 'react';
import { Upload } from 'lucide-react';

interface ImageUploaderProps {
  onImageLoad: (imageUrl: string) => void;
}

export function ImageUploader({ onImageLoad }: ImageUploaderProps) {
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (typeof event.target?.result === 'string') {
          onImageLoad(event.target.result);
        }
      };
      reader.readAsDataURL(file);
    }
  }, [onImageLoad]);

  return (
    <div className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer relative">
      <input
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
      <Upload className="w-12 h-12 text-gray-400 mb-4" />
      <p className="text-gray-600 font-medium">点击或拖拽上传图纸</p>
      <p className="text-gray-400 text-sm mt-2">支持 JPG, PNG 格式</p>
    </div>
  );
}
