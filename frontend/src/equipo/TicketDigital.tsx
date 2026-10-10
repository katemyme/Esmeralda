import { Download, Share2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiArchivo, mensajeDeError } from '../api/cliente';
import { Aviso, Boton } from '../ui/basicos';

/**
 * El ticket digital de una venta: el mismo ticket en PDF, para mandárselo a la clienta por
 * WhatsApp u otra aplicación. No es una impresión en papel: no cuenta como original ni como copia.
 *
 * El PDF se pide al aparecer el botón y no al tocarlo: compartir tiene que salir directamente del
 * toque (el iPhone lo rechaza si entre el toque y el compartir hubo una espera).
 */
export function TicketDigital({ ventaId, numero }: { ventaId: number; numero: string }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [direccion, setDireccion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    let url: string | null = null;
    void (async () => {
      try {
        const pdf = await apiArchivo('GET', `/ventas/${ventaId}/ticket-digital`);
        if (!vigente) return;
        const listo = new File([pdf], `ticket-${numero}.pdf`, { type: 'application/pdf' });
        url = URL.createObjectURL(listo);
        setArchivo(listo);
        setDireccion(url);
      } catch (causa) {
        if (vigente) setError(mensajeDeError(causa));
      }
    })();
    return () => {
      vigente = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [ventaId, numero]);

  if (error) return <Aviso tipo="error">No se pudo preparar el ticket digital. {error}</Aviso>;

  const puedeCompartir =
    archivo !== null &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [archivo] });

  if (puedeCompartir) {
    return (
      <Boton
        variante="secundario"
        onClick={() => {
          // Cerrar la hoja de compartir sin elegir nada no es un error
          void navigator
            .share({ files: [archivo], title: `Ticket ${numero}` })
            .catch(() => undefined);
        }}
      >
        <Share2 className="size-5" aria-hidden /> Compartir el ticket digital
      </Boton>
    );
  }

  // Sin «compartir» en este navegador (una computadora): se abre o se descarga el PDF
  return (
    <a
      href={direccion ?? undefined}
      download={`ticket-${numero}.pdf`}
      target="_blank"
      rel="noreferrer"
      aria-disabled={direccion === null}
      className={`inline-flex min-h-toque items-center justify-center gap-2 rounded-xl border border-borde bg-superficie px-5 text-base font-semibold text-texto hover:bg-esmeralda-claro ${direccion === null ? 'pointer-events-none opacity-55' : ''}`}
    >
      <Download className="size-5" aria-hidden />
      {direccion === null ? 'Preparando el ticket digital…' : 'Descargar el ticket digital'}
    </a>
  );
}
