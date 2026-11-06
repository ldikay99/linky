# Contribuir a Linky

Linky crece con quienes lo usan. Si tu asistente de IA corrige un bug o amplía algo (un comando, un endpoint,
una regla de tu área) y queda **funcional y probado**, puede proponerlo con un PR. El mantenedor
(**Jonathan Contreras**, @ldikay99) revisa y aprueba todo antes de integrarlo a `main`.

## En un comando

```bash
npm run contribute -- --topic "<tema corto>" --title "<título del PR>" --summary "<qué cambia y por qué>"
```

1. Corre `typecheck`, `test` y `scan`. Si algo falla, **no sube nada**.
2. Crea tu rama `contrib/<tu-usuario-github>/<tema>` (o reutiliza la tuya si ya estás en ella).
3. Hace commit con tu identidad de git y sube la rama al repo; si no tienes permiso de escritura, a tu fork.
4. Abre el PR contra `main`, o lo actualiza si ya existe. **Nunca integra**: eso lo decide el mantenedor.

Requisitos: [GitHub CLI](https://cli.github.com/) con sesión (`gh auth login`). Prueba con `--dry-run`.

## Reglas

- **Cero secretos**: nada de PATs, cookies, tokens, `.linky/`, perfiles de navegador ni datos reales de personas,
  organizaciones o reportes. El pre-commit (`npm run scan`) y el CI lo bloquean.
- **Datos sintéticos** en tests y ejemplos (`example.com`, `ExampleOrg`, nombres genéricos).
- **Fail-closed**: ante una respuesta incierta de Azure, Ripor o Google, detenerse y reconciliar; nunca reintentar a ciegas.
- **Aprobación de la persona** antes de cualquier escritura (preview + hash). No agregar atajos que la salten.
- Cambios de comportamiento: actualizar la skill correspondiente (`skills/`) y el README si aplica.
- Commits y PRs sin líneas de co-autoría ni créditos de herramientas de IA.
- Funciona en Windows, macOS y Linux: rutas con `path`, sin dependencias nativas nuevas sin necesidad.

## Si eres una IA

Cuando la persona pida un ajuste que debería servirle a todos (no algo solo de su configuración):

1. Haz el cambio mínimo y añade o actualiza los tests.
2. Pruébalo con las cuentas reales de la persona si aplica, **sin** dejar datos suyos en el repo.
3. Muéstrale el resumen y, con su aprobación, ejecuta `npm run contribute`.
4. Si luego pide más ajustes sobre lo mismo, sigue en su rama y vuelve a ejecutar `npm run contribute` (actualiza el PR).

Ajustes que son solo de su configuración (plantilla de chat, proyecto de área, organizaciones) **no** van al repo:
viven en su `~/.linky`.
