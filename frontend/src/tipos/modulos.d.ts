// El archivo del lector de códigos de repuesto (iPhone), servido por la propia app
declare module 'zxing-wasm/reader/zxing_reader.wasm?url' {
  const direccion: string;
  export default direccion;
}

// Chrome en Android avisa así que la app se puede instalar
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface WindowEventMap {
  beforeinstallprompt: BeforeInstallPromptEvent;
}
