import { Logger } from '@nestjs/common';
import type { BaseDatosService } from '../base-datos/base-datos.service';
import type { Configuracion } from '../configuracion/configuracion';
import { TareasService, type ResultadoTareas } from './tareas.service';

const QUINCE_MINUTOS = 15 * 60 * 1000;
const SIN_NOVEDAD: ResultadoTareas = {
  cajas_sin_cerrar: 0,
  foto_inventario: 0,
  devoluciones_vencidas: 0,
};

/** El servicio con `ejecutar()` reemplazado: aquí solo se prueba cuándo se llama. */
function servicio(tareasProgramadas: boolean) {
  const tareas = new TareasService({} as BaseDatosService, { tareasProgramadas } as Configuracion);
  const ejecutar = jest.spyOn(tareas, 'ejecutar').mockResolvedValue(SIN_NOVEDAD);
  return { tareas, ejecutar };
}

describe('TareasService: cuándo corren las tareas', () => {
  /** Lo que el servicio anota en el log (sin escribirlo en la consola de las pruebas). */
  let anotado: jest.SpyInstance;
  let errores: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    anotado = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    errores = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('corren al arrancar y después cada 15 minutos, hasta que el servidor se apaga', async () => {
    const { tareas, ejecutar } = servicio(true);
    tareas.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    expect(ejecutar).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(QUINCE_MINUTOS - 1000);
    expect(ejecutar).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1000);
    expect(ejecutar).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(2 * QUINCE_MINUTOS);
    expect(ejecutar).toHaveBeenCalledTimes(4);

    tareas.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(4 * QUINCE_MINUTOS);
    expect(ejecutar).toHaveBeenCalledTimes(4);
  });

  it('con TAREAS_PROGRAMADAS=false no se programa nada', async () => {
    const { tareas, ejecutar } = servicio(false);
    tareas.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(4 * QUINCE_MINUTOS);
    expect(ejecutar).not.toHaveBeenCalled();
    tareas.onApplicationShutdown();
  });

  it('si una pasada falla se anota y la siguiente se intenta igual', async () => {
    const { tareas, ejecutar } = servicio(true);
    ejecutar.mockRejectedValueOnce(new Error('la base no responde'));
    tareas.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    expect(errores).toHaveBeenCalledWith('Las tareas programadas fallaron: la base no responde');
    await jest.advanceTimersByTimeAsync(QUINCE_MINUTOS);
    expect(ejecutar).toHaveBeenCalledTimes(2);
    tareas.onApplicationShutdown();
  });

  it('una pasada que tarda más de 15 minutos no se encima con la siguiente', async () => {
    const { tareas, ejecutar } = servicio(true);
    let terminar: (resultado: ResultadoTareas) => void = () => undefined;
    ejecutar.mockReturnValueOnce(new Promise<ResultadoTareas>((resolver) => (terminar = resolver)));
    tareas.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(2 * QUINCE_MINUTOS);
    expect(ejecutar).toHaveBeenCalledTimes(1); // la primera sigue en curso

    terminar({ cajas_sin_cerrar: 2, foto_inventario: 5, devoluciones_vencidas: 1 });
    await jest.advanceTimersByTimeAsync(QUINCE_MINUTOS);
    expect(ejecutar).toHaveBeenCalledTimes(2);
    expect(anotado).toHaveBeenCalledWith('Cajas sin cerrar: 2 alerta(s) nueva(s)');
    expect(anotado).toHaveBeenCalledWith('Se guardó la foto mensual del inventario valorizado');
    expect(anotado).toHaveBeenCalledWith('Devoluciones aprobadas que vencieron sin ejecutarse: 1');
    tareas.onApplicationShutdown();
  });
});
