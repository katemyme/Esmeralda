import { useEffect, useRef, useState } from 'react';
import { Aviso } from '../ui/basicos';

/**
 * Lee códigos QR (y de barras) con la cámara. Usa el lector del navegador cuando existe (Chrome en
 * Android) y, si no (iPhone), uno propio que se descarga solo en ese momento. La cámara necesita
 * HTTPS (o localhost) y el permiso de la persona.
 *
 * Es el camino rápido, nunca el único: toda pantalla que lo use lleva además un buscador.
 */

const FORMATOS = ['qr_code', 'code_128', 'ean_13'] as const;

interface Lector {
  detect: (imagen: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
}

type LectorNativo = new (opciones: { formats: readonly string[] }) => Lector;

async function crearLector(): Promise<Lector> {
  const nativo = (globalThis as { BarcodeDetector?: LectorNativo }).BarcodeDetector;
  if (nativo) return new nativo({ formats: FORMATOS });
  // Sin lector propio en el navegador: el de repuesto, con su archivo servido por la propia app
  const [{ BarcodeDetector, prepareZXingModule }, wasm] = await Promise.all([
    import('barcode-detector/ponyfill'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ]);
  prepareZXingModule({
    overrides: {
      locateFile: (ruta: string, prefijo: string) =>
        ruta.endsWith('.wasm') ? wasm.default : prefijo + ruta,
    },
  });
  return new BarcodeDetector({ formats: [...FORMATOS] });
}

function mensajeDeCamara(error: unknown): string {
  const nombre = error instanceof Error ? error.name : '';
  if (nombre === 'NotAllowedError') {
    return 'No hay permiso para usar la cámara. Actívelo en los ajustes del navegador para este sitio.';
  }
  if (nombre === 'NotFoundError' || nombre === 'OverconstrainedError') {
    return 'Este equipo no tiene una cámara disponible.';
  }
  if (nombre === 'NotReadableError') return 'Otra aplicación está usando la cámara.';
  return 'No se pudo abrir la cámara.';
}

export function EscanerCamara({ alLeer }: { alLeer: (texto: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const aviso = useRef(alLeer);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    aviso.current = alLeer;
  }, [alLeer]);

  useEffect(() => {
    let vigente = true;
    let camara: MediaStream | null = null;
    let reloj = 0;

    void (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError('La cámara solo funciona con una dirección segura (https).');
        return;
      }
      try {
        camara = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (!vigente || !video.current) return;
        video.current.srcObject = camara;
        await video.current.play();
        const lector = await crearLector();
        let ultimo = '';
        const leer = async () => {
          if (!vigente || !video.current) return;
          try {
            const [codigo] = await lector.detect(video.current);
            if (codigo && codigo.rawValue !== ultimo) {
              ultimo = codigo.rawValue;
              aviso.current(codigo.rawValue);
            }
          } catch {
            // un cuadro que no se pudo leer: se intenta con el siguiente
          }
          reloj = window.setTimeout(() => void leer(), 250);
        };
        void leer();
      } catch (causa) {
        if (vigente) setError(mensajeDeCamara(causa));
      }
    })();

    return () => {
      vigente = false;
      window.clearTimeout(reloj);
      camara?.getTracks().forEach((pista) => pista.stop());
    };
  }, []);

  if (error) return <Aviso tipo="error">{error}</Aviso>;
  return (
    <video
      ref={video}
      muted
      playsInline
      aria-label="Vista de la cámara"
      className="aspect-video w-full rounded-2xl bg-texto object-cover"
    />
  );
}
