import React, { useEffect, useRef, useState } from 'react';
import { Copy, FolderOpen, Maximize2, Scan, X } from 'lucide-react';

export default function ImageViewer({ image, language, onClose, onNotice }) {
  const key = `mengx-image-view:${image.key || image.src}`;
  const [mode, setMode] = useState(() => localStorage.getItem(key) === 'actual' ? 'actual' : 'fit');
  const [size, setSize] = useState(null);
  const [failed, setFailed] = useState(false);
  const imageRef = useRef(null);
  useEffect(() => { localStorage.setItem(key, mode); }, [key, mode]);
  const zh = language === 'zh';
  async function copy() {
    try {
      const bitmap = imageRef.current;
      if (!bitmap?.complete || !bitmap.naturalWidth) throw new Error('Image unavailable');
      const scale = Math.min(1, Math.sqrt(16000000 / (bitmap.naturalWidth * bitmap.naturalHeight)));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(bitmap.naturalHeight * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Image unavailable');
      if (image.handle?.desktop && image.source) await window.mengxDesktop.copyImage(image.handle.id, image.source, await blob.arrayBuffer());
      else await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      onNotice(zh ? '图片已复制' : 'Image copied');
    } catch { onNotice(zh ? '无法复制图片，请检查资源是否可读' : 'Unable to copy this image'); }
  }
  return <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={zh ? '图片查看' : 'Image viewer'}>
    <div className="image-viewer-toolbar"><span>{image.alt || image.source || (zh ? '图片' : 'Image')}{size && ` · ${size.width} × ${size.height}`}</span>
      <button className={`icon-button quiet ${mode === 'fit' ? 'active' : ''}`} aria-label={zh ? '适应窗口' : 'Fit window'} title={zh ? '适应窗口' : 'Fit window'} onClick={() => setMode('fit')}><Scan size={17} /></button>
      <button className={`icon-button quiet ${mode === 'actual' ? 'active' : ''}`} aria-label={zh ? '原始尺寸' : 'Actual size'} title={zh ? '原始尺寸' : 'Actual size'} onClick={() => setMode('actual')}><Maximize2 size={17} /></button>
      <button className="icon-button quiet" aria-label={zh ? '复制图片' : 'Copy image'} title={zh ? '复制图片' : 'Copy image'} onClick={() => void copy()} disabled={failed}><Copy size={17} /></button>
      {image.handle?.desktop && image.source && <button className="icon-button quiet" aria-label={zh ? '打开图片所在文件夹' : 'Show image in folder'} title={zh ? '打开图片所在文件夹' : 'Show image in folder'} onClick={() => window.mengxDesktop.revealResource(image.handle.id, image.source).catch(() => onNotice(zh ? '资源无法定位' : 'Resource unavailable'))}><FolderOpen size={17} /></button>}
      <button autoFocus className="icon-button quiet" onClick={onClose} aria-label={zh ? '关闭图片' : 'Close image'}><X size={18} /></button>
    </div>
    <div className={`image-viewer-canvas ${mode}`} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      {failed ? <p>{zh ? '图片无法读取：' : 'Image unavailable: '}{image.source || image.src}</p> : <img ref={imageRef} crossOrigin="anonymous" src={image.src} alt={image.alt || ''} onLoad={(event) => setSize({ width: event.target.naturalWidth, height: event.target.naturalHeight })} onError={() => setFailed(true)} />}
    </div>
  </div>;
}
