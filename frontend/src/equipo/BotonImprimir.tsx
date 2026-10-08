import { Printer } from 'lucide-react';
import { useRef, useState } from 'react';
import { api, apiArchivo, mensajeDeError, ErrorApi } from '../api/cliente';
import type { Renglon } from '../api/tipos';
import { Aviso, Boton } from '../ui/basicos';
import { comandosDeTicket, imprimirConDialogo, imprimirPorUsb, modoDeImpresion } from './imprimir';
import { mensajeDeImpresora } from './impresora';

interface Props {
  /** La ruta de la API que entrega el ticket, p. ej. `/turnos/9/imprimir`. */
  ruta: string;
  texto?: string;
}

/**
 * Imprime un ticket de la forma que le toca a este equipo: directo por USB en el celular o la
 * tablet Android, o por el diálogo de imprimir en la PC de caja. El diálogo siempre queda de
 * respaldo.
 *
 * El ticket se le pide a la API una sola vez y se guarda: si la impresora falla, «Reintentar»
 * vuelve a enviar el mismo, sin que la API lo cuente como otra impresión (saldría como COPIA).
 */
export function BotonImprimir({ ruta, texto = 'Imprimir ticket' }: Props) {
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<{ tipo: 'exito' | 'error'; texto: string } | null>(
    null,
  );
  const [fallo, setFallo] = useState(false);
  const [pedido, setPedido] = useState(false);
  const porUsb = useRef<Uint8Array | null>(null);
  const enPdf = useRef<Blob | null>(null);
  const modo = modoDeImpresion();

  const imprimir = async (forma: 'usb' | 'dialogo') => {
    setOcupado(true);
    setResultado(null);
    try {
      if (forma === 'usb') {
        porUsb.current ??= comandosDeTicket(
          (await api<{ renglones: Renglon[] }>('POST', `${ruta}?formato=renglones`)).renglones,
        );
        await imprimirPorUsb(porUsb.current);
        setResultado({ tipo: 'exito', texto: 'El ticket se envió a la impresora.' });
      } else {
        enPdf.current ??= await apiArchivo('POST', ruta);
        await imprimirConDialogo(enPdf.current);
        setResultado({ tipo: 'exito', texto: 'El ticket se envió a imprimir.' });
      }
      setFallo(false);
      setPedido(true);
    } catch (error) {
      setFallo(true);
      setResultado({
        tipo: 'error',
        texto: error instanceof ErrorApi ? mensajeDeError(error) : mensajeDeImpresora(error),
      });
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {resultado && <Aviso tipo={resultado.tipo}>{resultado.texto}</Aviso>}
      <Boton ocupado={ocupado} onClick={() => void imprimir(modo)}>
        <Printer className="size-5" aria-hidden />
        {fallo ? 'Reintentar la impresión' : pedido ? '¿No salió? Reimprimir' : texto}
      </Boton>
      {modo === 'usb' && (
        <Boton variante="texto" disabled={ocupado} onClick={() => void imprimir('dialogo')}>
          Imprimir con el diálogo del sistema
        </Boton>
      )}
    </div>
  );
}
