# AIT Signs workbook profile

Workbook: `/root/.openclaw/media/inbound/AiT_15_SIGNS_WORK-ESTIMATES---adcfba27-3c56-4bec-99ab-b5e05165f79d.xlsx`

## Sheet summary

- 1. INTERESADOS: prospects, 106/408 non-empty rows, max 48 cols, header row 7
- 2. ESTIMADOS: estimates, 139/438 non-empty rows, max 62 cols, header row 9
- 3. 15 SIGNS WORK ORDER: work_orders, 269/860 non-empty rows, max 62 cols, header row 13
- WORK ORDER TERMINADOS Y PAGADOS: completed_paid, 1818/2158 non-empty rows, max 57 cols, header row 11
- Sheet13: mixed, 0/0 non-empty rows, max 0 cols, header row none
- Sheet12: mixed, 3/3 non-empty rows, max 5 cols, header row none

## Heuristic notes

- The workbook contains multiple lifecycle tabs rather than one flat table.
- Spanish notes, status legends, balances, and follow-up notes are mixed into the same source rows.
- A read-only staging/import pipeline is required before any production import.

## Sample rows

### 1. INTERESADOS
- AiT  SIGNS | Call or Text 732-379-0593 | LO REALIZO EN OTRO LUGAR
SOLICITO NO LLAMARLO
- P  R  I  N  T  I  N  G  | VOLVER A LLAMAR NO CONTESTO
- WEB PAGE & DIGITAL ADS | SE CONTACTO, ESTA EN SEGUIMIENTO
- PROSPECTOS O INTERESADOS  | (CLIENTES QUE ENTRARON POR ALGUNA PROMOCION O SIMPLEMENTE  NECESITAN  CONTACTAR LOS SERVICIO )
- NOTA  :    CUANDO CLIENTE,  DEBE MOVER A    "15 WORK ORDER" | OPERATION | MONTO PACTADO Y AVANCE | COBRANZAS | BALANCE  | SEGUIMIENTO 1 | SEGUIMIENTO 2 | SEGUIMIENTO 3 | SEGUIMIENTO 4 | SEGUIMIENTO 5

### 2. ESTIMADOS
- AiT  SIGNS | Call or Text 732-379-0593 | LO REALIZO EN OTRO LUGAR
SOLICITO NO LLAMARLO
- P  R  I  N  T  I  N  G  | VOLVER A LLAMAR NO CONTESTO
- WEB PAGE & DIGITAL ADS | DEBE PASAR DE  ESTIMADO A  15 WORK ORDER
- NO FUE APROBADO
- ESTAMOS EN CONVERSACIONES 

### 3. 15 SIGNS WORK ORDER
- AiT  SIGNS | ACTUAL STATUS | 741.04
- P  R  I  N  T  I  N  G  | ***** | ESPERANDO RESPUESTA DE CLIENTE
- WEB PAGE & DIGITAL ADS | Llama o Text 732-379-0593 | LISTO PARA ENTREGAR | 270.4 | 288.31
- **** | AUN  NO SE HIZO NADA | 58 | 35.4 | 653.26 | 1682.61
- YA NO VA (ANULARL.O) | 982.61

### WORK ORDER TERMINADOS Y PAGADOS
- AiT  SIGNS | Llamar o Text 732-379-0593
- P   R    I    N   T   I   N   G
- DIGITAL ADS & WEB PAGE
- WORK ORDER - CENTRAL - OFICIAL | 290
- VIENE A HACER EL PEDIDO  | LLAMAR PARA TOMAR PEDIDO 

### Sheet13

### Sheet12
- ESTAMPADO 6 CHALECOS | 57.0 | 3.77625 | 60.77625
- ESTAMPADOS 10 POLOS Y 8 HOODIES  | 162 | 10.7325 | 172.7325
- 200 HOJAS AMBOS LADOS  8.5 X 11"   | 350.0 | 23.1875 | 373.1875

