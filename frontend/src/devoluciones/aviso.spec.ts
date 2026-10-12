import { describe, expect, it } from 'vitest';
import { solicitud } from '../pruebas/devoluciones';
import { enlaceDeAviso, numeroDeWhatsapp, textoDeAviso } from './aviso';

describe('aviso por WhatsApp al administrador', () => {
  it('el mensaje lleva la solicitud, la factura, el monto y la sucursal; nunca al cliente', () => {
    const texto = textoDeAviso(solicitud());
    expect(texto.split('\n')).toEqual([
      'Solicitud de devolución n.º 12',
      'Factura: LAM-00000012',
      'Monto: C$ 1,200.00',
      'Sucursal: Multicentro Las Américas',
      'Está esperando su aprobación en el sistema.',
    ]);
    expect(texto).not.toMatch(/Carla|8888/);
    expect(textoDeAviso(solicitud({ tipo: 'CAMBIO' }))).toMatch(/^Solicitud de cambio n\.º 12/);
  });

  it('el enlace abre WhatsApp con el número del administrador y el mensaje ya escrito', () => {
    const pendiente = solicitud({ aviso_whatsapp: '50588887777' });
    const enlace = enlaceDeAviso(pendiente) ?? '';
    expect(enlace.startsWith('https://wa.me/50588887777?text=')).toBe(true);
    expect(decodeURIComponent(enlace.split('?text=')[1])).toBe(textoDeAviso(pendiente));
  });

  it('sin número, o cuando ya se resolvió, no hay enlace', () => {
    expect(enlaceDeAviso(solicitud())).toBeNull();
    expect(
      enlaceDeAviso(solicitud({ aviso_whatsapp: '50588887777', estado: 'APROBADA' })),
    ).toBeNull();
  });

  it('el número se guarda solo con dígitos; vacío es «sin número» y lo demás no vale', () => {
    expect(numeroDeWhatsapp('+505 8888-7777')).toBe('50588887777');
    expect(numeroDeWhatsapp('  ')).toBe('');
    expect(numeroDeWhatsapp('8888')).toBeNull(); // sin el código del país
    expect(numeroDeWhatsapp('mi número')).toBeNull();
    expect(numeroDeWhatsapp('1234567890123456')).toBeNull(); // 16 dígitos
  });
});
