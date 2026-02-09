---
name: wa-conversation-analyst
description: Analiza conversaciones de WhatsApp para generar resumenes, detectar temas y evaluar sentimiento
metadata:
  openclaw:
    emoji: "\U0001F4CA"
    bins: []
    env: []
---

## Descripcion
Skill para analizar patrones de conversacion en WhatsApp. Genera resumenes estructurados, extrae temas principales y evalua el sentimiento general de cada conversacion.

## Capacidades

### Resumen de Conversacion
Dada una lista de mensajes, genera un resumen conciso que capture:
- Temas principales discutidos
- Decisiones o acuerdos tomados
- Preguntas pendientes sin responder
- Tono general de la conversacion

### Extraccion de Temas
Identifica y categoriza los temas principales:
- Trabajo / Profesional
- Personal / Familia
- Coordinacion / Logistica
- Urgente / Accion requerida
- Informativo / FYI

### Deteccion de Idioma
Detecta automaticamente el idioma de los mensajes para adaptar las respuestas.

## Ejemplos de Uso
- "Resume la conversacion del grupo Familia del dia de hoy"
- "Cuales son los temas principales del chat de Trabajo esta semana?"
- "Hay mensajes urgentes que necesiten atencion?"
- "Genera un reporte semanal de todas mis conversaciones"

## Formato de Salida

### Resumen Diario
```
Resumen [Nombre del Chat] - [Fecha]
Mensajes: [N]
Temas: [lista]
Resumen: [2-3 oraciones]
Pendientes: [lista o "ninguno"]
```

### Reporte Semanal
```
Reporte Semanal [Fecha Inicio] - [Fecha Fin]
Conversaciones activas: [N]
Total mensajes: [N]
Top 5 chats mas activos: [lista]
Temas recurrentes: [lista]
Highlights: [2-3 puntos clave]
```
