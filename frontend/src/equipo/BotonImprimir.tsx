import { Printer } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, apiArchivo, mensajeDeError, ErrorApi } from '../api/cliente';
import type { TicketEnRenglones } from '../api/tipos';
import { Aviso, Boton } from '../ui/basicos';
import { comandosDeTicket, imprimirConDialogo, imprimirPorUsb, modoDeImpresion } from './imprimir';
import { mensajeDeImpresora } from './impresora';

interface Props {
  /** La ruta de la API que entrega el ticket, p. ej. `/turnos/9/imprimir`. */
  ruta: string;
  texto?: string;
  /** Lo manda a imprimir al aparecer, sin esperar el toque (el ticket de una venta recién hecha). */
  automatico?: boolean;
  /**
   * Al terminar el primer intento, salga o falle: para mandar otro ticket después de este y no a
   * la vez (a la impresora por USB no se le mandan dos juntos).
   */
  alTerminar?: () => void;
  /** Ofrecer también el diálogo del sistema en Android (con varios botones, basta uno). */
  conDialogo?: boolean;
}

/**
 * Imprime un ticket de la forma que le toca a este equipo: directo por USB en el celular o la
 * tablet Android, o por el diálogo de imprimir en la PC de caja. El diálogo siempre queda de
 * respaldo.
 *
 * El ticket se le pide a la API una sola vez y se guarda: si la impresora falla, «Reintentar»
 * vuelve a enviar el mismo, sin que la API lo cuente como otra impresión (saldría como COPIA).
 * Por USB, el ticket trae si hay que abrir la gaveta (una venta cobrada en efectivo).
 */
export function BotonImprimir({
  ruta,
  texto = 'Imprimir ticket',
  automatico = false,
  alTerminar,
  conDialogo = true,
}: Props) {
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<{ tipo: 'exito' | 'error'; texto: string } | null>(
    null,
  );
  const [fallo, setFallo] = useState(false);
  const [pedido, setPedido] = useState(false);
  const porUsb = useRef<Uint8Array | null>(null);
  const enPdf = useRef<Blob | null>(null);
  const modo = modoDeImpresion();
  // Se avisa una sola vez: después del primer intento, haya salido o no
  const terminado = useRef(false);
  const avisar = useRef(alTerminar);
  useEffect(() => {
    avisar.current = alTerminar;
  });

  const imprimir = async (forma: 'usb' | 'dialogo') => {
    setOcupado(true);
    setResultado(null);
    try {
      if (forma === 'usb') {
        if (!porUsb.current) {
          const ticket = await api<TicketEnRenglones>('POST', `${ruta}?formato=renglones`);
          porUsb.current = comandosDeTicket(ticket.renglones, { gaveta: ticket.abrir_gaveta });
        }
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
      if (!terminado.current) {
        terminado.current = true;
        avisar.current?.();
      }
    }
  };
  // Una sola vez, aunque la pantalla se vuelva a dibujar
  const yaSalio = useRef(false);
  const alAparecer = useRef(imprimir);
  useEffect(() => {
    if (!automatico || yaSalio.current) return;
    yaSalio.current = true;
    void alAparecer.current(modo);
  }, [automatico, modo]);

  return (
    <div className="flex flex-col gap-3">
      {resultado && <Aviso tipo={resultado.tipo}>{resultado.texto}</Aviso>}
      <Boton
        variante={automatico && !fallo ? 'secundario' : 'primario'}
        ocupado={ocupado}
        onClick={() => void imprimir(modo)}
      >
        <Printer className="size-5" aria-hidden />
        {fallo ? 'Reintentar la impresión' : pedido ? '¿No salió? Reimprimir' : texto}
      </Boton>
      {modo === 'usb' && conDialogo && (
        <Boton variante="texto" disabled={ocupado} onClick={() => void imprimir('dialogo')}>
          Imprimir con el diálogo del sistema
        </Boton>
      )}
    </div>
  );
}
