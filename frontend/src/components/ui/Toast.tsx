'use client';

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useToastStore, ToastMessage } from '../../store/toastStore';
import { CheckCircle, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToastStore();

  return (
    <div className="fixed bottom-24 right-6 z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full">
      <AnimatePresence>
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
};

const ToastItem: React.FC<{ toast: ToastMessage; onClose: () => void }> = ({ toast, onClose }) => {
  const icons = {
    success: <CheckCircle className="text-green-500 w-5 h-5 flex-shrink-0" />,
    error: <AlertCircle className="text-red-500 w-5 h-5 flex-shrink-0" />,
    info: <Info className="text-blue-500 w-5 h-5 flex-shrink-0" />,
    warning: <AlertTriangle className="text-yellow-500 w-5 h-5 flex-shrink-0" />,
  };

  const bgStyles = {
    success: 'border-green-500/30 bg-green-950/20 shadow-green-950/10',
    error: 'border-red-500/30 bg-red-950/20 shadow-red-950/10',
    info: 'border-blue-500/30 bg-blue-950/20 shadow-blue-950/10',
    warning: 'border-yellow-500/30 bg-yellow-950/20 shadow-yellow-950/10',
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 50, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.15 } }}
      className={`pointer-events-auto flex items-center gap-3 p-4 rounded-xl border backdrop-blur-xl shadow-lg transition-all duration-300 ${bgStyles[toast.type]}`}
    >
      {icons[toast.type]}
      <p className="text-sm font-medium text-white flex-1 leading-snug">{toast.message}</p>
      <button
        onClick={onClose}
        className="text-zinc-400 hover:text-white transition-colors duration-150 p-1 rounded-lg hover:bg-white/5 cursor-pointer"
      >
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
};
