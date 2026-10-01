import { types, type CustomTypesConfig } from 'pg';

/**
 * Cómo se convierten algunos tipos de PostgreSQL al leerlos. Debe coincidir con
 * .kysely-codegenrc.json para que los tipos generados (tipos-bd.ts) digan la verdad:
 *  - bigint  → number: ids y conteos (nunca superan 2^53).
 *  - date    → texto 'AAAA-MM-DD': sin convertir a Date, así no se corre un día por la zona horaria.
 *  - numeric → texto (comportamiento de pg): montos exactos; los cálculos de dinero los hace la base.
 */
export const tiposPg: CustomTypesConfig = {
  getTypeParser: ((oid: number, formato?: 'text' | 'binary') => {
    if (oid === types.builtins.INT8) return (valor: string) => Number(valor);
    if (oid === types.builtins.DATE) return (valor: string) => valor;
    return types.getTypeParser(oid, formato);
  }) as CustomTypesConfig['getTypeParser'],
};
