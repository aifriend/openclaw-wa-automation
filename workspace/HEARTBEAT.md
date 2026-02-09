# Tareas Periodicas (Heartbeat)

## Cada 30 minutos
- Verificar conexion con Slack (estado del bot)
- Verificar integridad del registro de threads (wa-slack-threads.json)
- Flush de mensajes pendientes en la cola de Slack
- Reportar si hay errores acumulados

## Diario a las 23:00 (America/Lima)
- Generar resumen diario de cada conversacion activa
- Publicar resumen como reply en el thread correspondiente de Slack
- Incluir: cantidad de mensajes, temas principales, auto-respuestas enviadas

## Semanal (Lunes 10:00 America/Lima)
- Generar reporte semanal consolidado
- Publicar como nuevo mensaje en #wa-monitor
- Incluir: conversaciones mas activas, tendencias, estadisticas de auto-respuestas
