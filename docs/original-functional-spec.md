# Especificación Funcional: Suite de Aplicaciones Modular Multiplataforma

---

## 1. Arquitectura Base y Ecosistema de Módulos (Core Host)

### [CORE-001] Inicialización y Runtime de Clientes (Host Shell)
* **Descripción:** Aplicación base (*host shell*) en Web, Desktop y Mobile responsable del ciclo de vida de la aplicación, el montaje del layout principal y la provisión de un sandbox de ejecución para los módulos externos.
* **Alcance:** `Web` | `Desktop` | `Mobile (Android/iOS)`
* **Comportamiento clave:**
  * Carga inicial ligera: el binario/bundle base contiene únicamente el shell, el motor de resolución de módulos y los servicios core.
  * Expone un contrato de API interna / SDK host (autenticación, persistencia local, bus de eventos inter-módulo, puente nativo).
  * Aislamiento de ejecución: los fallos o errores de renderizado de un módulo hijo son capturados mediante límites de error (*error boundaries*) sin comprometer la ejecución del shell principal.
* **Dependencias / Integración:** API Gateway, capa de almacenamiento local nativo (`IndexedDB` en Web, `SQLite` o almacenamiento encriptado en Desktop/Mobile).
* **Notas de UI/UX:** Pantalla de arranque mínima con verificación de integridad del entorno base antes de mostrar el layout del sistema.

---

### [CORE-002] Gestor de Carga Dinámica de Módulos (Plugin Loader)
* **Descripción:** Subsistema cliente encargado de resolver, descargar bajo demanda, verificar criptográficamente e instanciar en tiempo de ejecución los bundles independientes de cada módulo.
* **Alcance:** `Web` | `Desktop` | `Mobile (Android/iOS)`
* **Comportamiento clave:**
  * Carga asíncrona (*lazy loading / dynamic import*) a partir del manifiesto de módulos habilitados.
  * Verificación de integridad: comprobación de firma y checksum SHA-256 de cada paquete descargado antes de montarlo en memoria.
  * Compatibilidad de versiones: valida que la versión del módulo cumpla con el rango soportado por la versión del Host Shell instalada (SemVer).
  * Persistencia en caché local: los paquetes descargados se almacenan localmente para permitir su inicialización sin conexión a internet.
* **Dependencias / Integración:** `[STORE-001]`, `[STORE-003]`, CDN de artefactos modulares, almacenamiento en disco local.
* **Notas de UI/UX:** Carga transparente en segundo plano; si un módulo tarda en resolver, muestra un placeholder de carga (*skeleton*) acotado al área del módulo.

---

### [CORE-003] Arquitectura de Módulos Full-Stack Embebidos (Frontend + Backend Local)
* **Descripción:** Modelo de empaquetado donde cada módulo se distribuye como una unidad autocontenida que aloja tanto su interfaz de usuario (Frontend) como su propio controlador de lógica y datos para ejecución en el cliente (Backend Local).
* **Alcance:** `Web` | `Desktop` | `Mobile (Android/iOS)`
* **Comportamiento clave:**
  * **Bundle Dual Unificado:** Cada módulo incluye su capa visual construida con el kit semántico del Host (`@host/ui`) y su micro-controlador de backend local ejecutado en un entorno aislado (Worker dedicado en Web/Desktop o hilo secundario seguro en Mobile).
  * **Autonomía Operativa Total (Offline-First):** El backend local gestiona reglas de negocio, validaciones complejas y la persistencia en su base de datos local encriptada (`[SEC-002]`), operando de forma autónoma sin depender de conectividad continua con el servidor central.
  * **Sincronización Asíncrona:** La comunicación con la API central se reserva para respaldos, eventos corporativos multiusuario y acuerdos de replicación, evitando que la interacción habitual dependa de la red.
* **Dependencias / Integración:** `[CORE-001]`, `[CORE-002]`, `[SEC-002]`.
* **Notas de UI/UX:** Cero latencia percibida: la interfaz responde de inmediato al interactuar directamente con su propio motor local.

---

### [CORE-004] Bus de Servicios Local e Invocación Directa entre Módulos (Local RPC Broker)
* **Descripción:** Mecanismo de interoperabilidad en memoria que permite a un módulo consumir servicios y métodos de otro módulo dependiente de forma estrictamente local, sin recurrir a la API remota ni obligar a negociar contratos de red complejos.
* **Alcance:** `Web` | `Desktop` | `Mobile (Android/iOS)`
* **Comportamiento clave:**
  * **Registro y Publicación de Contratos:** Al instanciarse, el backend local de cada módulo publica en el registro de servicios del Host Shell su interfaz pública tipada (métodos y eventos expuestos).
  * **Invocación Directa en Memoria (Local RPC):** Cuando el Módulo A declara en sus dependencias al Módulo B:
    * El Host Shell resuelve la dependencia y entrega al Módulo A un cliente tipado del backend local de B.
    * Todas las llamadas entre A y B se ejecutan en memoria de proceso (IPC de ultra-baja latencia) sin formular peticiones HTTP ni consultar la API en la nube.
  * **Desacoplamiento Funcional:** Ninguno de los dos módulos necesita aprenderse rutas ni formatos de endpoints REST/GraphQL de la API central; la interacción ocurre a nivel de métodos directos del SDK local.
  * **Validación de Concesión en Runtime:** Antes de conectar el puente de llamadas, el Host Shell comprueba que el Módulo A cuente con la debida autorización de acceso concedida sobre los datos y funciones del Módulo B (`[BACK-002]`).
* **Dependencias / Integración:** `[CORE-001]`, `[CORE-003]`, `[BACK-002]`.
* **Notas de UI/UX:** Operaciones interconectadas instantáneas (por ejemplo, generar un pedido en una herramienta y actualizar de inmediato el inventario local sin esperas ni pausas por carga de red).

---

## 2. Gestión de Identidad, Autenticación y Cuentas

### [AUTH-001] Tipología de Cuentas y Acceso Dual
* **Descripción:** Mecanismo de autenticación que distingue y administra dos tipos de usuarios: Cuentas Locales (exclusivas del dispositivo) y Cuentas Online (sincronizadas en la nube).
* **Alcance:** `API` | `Web` | `Desktop` | `Mobile (Android/iOS)`
* **Comportamiento clave:**
  * **Cuentas Locales (Desktop/Mobile):**
    * Los datos, configuraciones y credenciales residen estrictamente en la base de datos local encriptada del dispositivo.
    * No requieren conexión a internet para autenticación ni uso de módulos instalados.
    * Cifrado local de base de datos con derivación de clave (PBKDF2/Argon2) a partir de la contraseña o PIN maestro local.
  * **Cuentas Online (Todas las plataformas):**
    * Autenticación contra el servidor central (JWT/PASETO + Refresh Tokens en rotación).
    * Soporte para MFA (TOTP, SMS o llaves FIDO2).
    * Sincronización de perfiles, licencias activas y permisos en la nube.
* **Dependencias / Integración:** API de Autenticación, Keychain/Keystore del sistema operativo.
* **Notas de UI/UX:** Pantalla de selección de tipo de acceso al iniciar la app ("Acceder con Cuenta Online" o "Usar Perfil Local en este Dispositivo").

---

### [AUTH-002] Selector de Perfiles y Pantalla de Bienvenida Multiusuario
* **Descripción:** Interfaz de entrada para seleccionar un perfil guardado en el dispositivo o iniciar sesión con una cuenta nueva.
* **Alcance:** `Desktop` | `Mobile (Android/iOS)` | `Web`
* **Comportamiento clave:**
  * Detección de sesiones previas en el dispositivo: lista perfiles locales y cuentas online registradas anteriormente con su avatar y nombre.
  * Reautenticación rápida: soporte de desbloqueo biométrico nativo (FaceID, TouchID, huella dactilar) o PIN numérico rápido en perfiles locales y online recordados.
  * Botón explícito de "Agregar nueva cuenta / Iniciar otra sesión" y opción de eliminar perfiles locales guardados del dispositivo.
* **Dependencias / Integración:** Biometría nativa del sistema operativo, `[AUTH-001]`.
* **Notas de UI/UX:** Tarjetas o avatares de acceso rápido al estilo selector de usuarios de SO; protección con desenfoque de pantalla si la app entra en segundo plano.

---

## 3. Estructura de Navegación del Shell

### [SHELL-001] Conmutador de Espacios de Trabajo (Personal vs. Empresa)
* **Descripción:** Selector de contexto de ejecución que permite al usuario alternar de manera instantánea entre su configuración personal y los perfiles de empresa en los que participa.
* **Alcance:** `Web` | `Desktop` | `Mobile (Android/iOS)`
* **Comportamiento clave:**
  * Carga por defecto del perfil personal al iniciar sesión.
  * Selector global tipo *dropdown* ubicado en la parte superior de la barra lateral:
    * Muestra la cuenta personal y el listado de empresas asociadas a las que pertenece el usuario.
  * Al conmutar de contexto:
    * Se recargan dinámicamente las herramientas disponibles, los permisos de rol correspondientes a esa empresa y la configuración de interfaz asignada por dicha organización.
    * El estado y los datos de un espacio de trabajo se aíslan completamente del otro.
* **Dependencias / Integración:** `[CORE-001]`, `[AUTH-001]`, `[ORG-001]`.
* **Notas de UI/UX:** Cambio visual inmediato con transiciones suaves; indicador de color o logotipo de la empresa activa en el encabezado para no confundir el espacio de trabajo.

---

### [SHELL-002] Disposición de Barra Lateral (Sidebar Ergonómica)
* **Descripción:** Panel de navegación principal estructurado jerárquicamente para dar acceso a módulos, configuración de cuenta y la tienda.
* **Alcance:** `Web` | `Desktop` | `Mobile (Android/iOS)`
* **Comportamiento clave:**
  * **Sección Superior:** Selector de Espacio de Trabajo (`[SHELL-001]`).
  * **Sección Central (Scrolleable):** Lista vertical de herramientas y módulos instalados/accesibles para el contexto activo. Cada módulo expone su icono oficial y etiqueta.
  * **Sección Inferior (Fijada al pie):**
    * Acceso directo a la Tienda de Módulos (`[STORE-001]`).
    * Perfil de Usuario activo (acceso a ajustes de cuenta, estado de conectividad y cierre de sesión).
* **Dependencias / Integración:** `[CORE-002]`, `[STORE-001]`, `[AUTH-002]`.
* **Notas de UI/UX:**
  * En Desktop/Web: Barra lateral colapsable (modo iconos compactos vs. expandido).
  * En Mobile: Barra lateral convertida en Drawer lateral deslizante o barra inferior fija según el factor de forma.

---

## 4. Licenciamiento y Notificaciones Organizacionales

### [ORG-001] Sistema de Licencias Maestras y Sublicencias Corporativas
* **Descripción:** Capacidad de una organización de adquirir licencias de uso de la suite/módulos y asignar sublicencias nominativas a sus colaboradores.
* **Alcance:** `API` | `Web` | `Desktop` | `Mobile (Android/iOS)`
* **Comportamiento clave:**
  * El administrador de la empresa introduce el identificador (correo o ID de usuario online) del colaborador para emitir una asignación de sublicencia.
  * La emisión genera una solicitud pendiente de vinculación que se transmite al sistema de notificaciones del empleado.
  * Una vez aceptada por el empleado, el espacio de trabajo de la empresa se activa en su menú de selección (`[SHELL-001]`).
  * En caso de rescisión o baja del empleado, el administrador puede revocar la sublicencia inmediatamente, revocando el token de acceso a los datos corporativos.
* **Dependencias / Integración:** `[AUTH-001]`, pasarela de licenciamiento, `[NOTIF-001]`.
* **Notas de UI/UX:** Panel de administración con conteo de cupos disponibles (`Sublicencias totales`, `Asignadas`, `Disponibles`).

---

### [NOTIF-001] Bandeja Centralizada de Notificaciones e Invitaciones
* **Descripción:** Centro de notificaciones unificado para alertas del sistema, avisos de módulos e invitaciones de membresía organizacional.
* **Alcance:** `Web` | `Desktop` | `Mobile (Android/iOS)`
* **Comportamiento clave:**
  * Recepción de tarjeta interactiva: *"La empresa [Nombre] te ha otorgado una sublicencia y te invita a unirte a su organización"*.
  * Acciones directas integradas en la notificación: botón de **"Aceptar"** y **"Rechazar"**.
  * Al hacer clic en Aceptar:
    * Se formaliza la relación usuario-organización en la API.
    * Se añade automáticamente el perfil corporativo al selector de espacios de trabajo (`[SHELL-001]`).
  * Notificaciones push nativas en Mobile y Desktop para alertar sobre nuevas invitaciones entrantes.
* **Dependencias / Integración:** WebSocket / Push Notification Service (FCM/APNs), `[ORG-001]`.
* **Notas de UI/UX:** Icono de campana en el header o barra inferior con badge indicador de invitaciones pendientes; animación de confirmación al aceptar.

---

## 5. Estructura Organizacional y Jerarquía Visual

### [ORG-002] Diseñador Visual de Organigrama (Canvas Interactivo)
* **Descripción:** Herramienta visual en lienzo interactivo para modelar la jerarquía de rangos de una empresa mediante nodos y conexiones dirigidas.
* **Alcance:** `Web` | `Desktop`
* **Comportamiento clave:**
  * **Elementos base del diagrama:**
    * **Rangos (Nodos):** Representan los puestos o escalafones jerárquicos (ej. Dirección, Gerente de Operaciones, Analista).
    * **Conexiones (Aristas dirigidas):** Flechas en un solo sentido que expresan la relación de mando/supervisión (Superior $\rightarrow$ Inferior).
  * **Reglas de Integridad Estructural:**
    * **Nodo Raíz Inmutable:** Existe un rango raíz llamado obligatoriamente `Administrador`, el cual no puede ser eliminado ni desconectado.
    * **Cero Nodos Huérfanos:** Ningún rango puede existir sin estar conectado directa o indirectamente desde la raíz `Administrador`.
    * **Dirección de Dependencias:** Toda arista debe nacer en un rango superior y apuntar hacia el inferior. No se permiten aristas invertidas.
    * **Topología Múltiple:** Se admiten relaciones $1:N$ (un superior con múltiples subordinados) y $N:1$ (múltiples superiores apuntando a un mismo inferior).
    * **Prevención de Ciclos:** El motor del canvas valida en tiempo real que no se generen bucles de supervisión circular (Grafo Dirigido Acíclico - DAG).
* **Dependencias / Integración:** `[ORG-001]`, motor de renderizado vectorial/canvas (`SVG` o `Canvas API`).
* **Notas de UI/UX:**
  * Interfaz drag-and-drop con snapping a cuadrícula, zoom infinito, minimapa y botón de auto-organizado de nodos jerárquicos.
  * Si el usuario intenta guardar con nodos desconectados, el lienzo resalta los nodos huérfanos con contorno rojo y bloquea el guardado.

---

### [ORG-003] Motor de Grupos, Etiquetas y Mapeo Masivo de Permisos
* **Descripción:** Sistema de clasificación transversal para agrupar rangos y acelerar la distribución de directivas y privilegios dentro del organigrama.
* **Alcance:** `API` | `Web` | `Desktop`
* **Comportamiento clave:**
  * **Grupos Lógicos:** Agrupaciones formales de rangos (ej. "Departamento Comercial", "Mesa de Ayuda") para asignar políticas conjuntas.
  * **Etiquetas (Tags):** Metadatos clave-valor o badges asignables a uno o más rangos (ej. `#aprobador-gastos`, `#acceso-confidencial`, `#personal-campo`).
  * **Aplicación de Políticas:** Posibilidad de conceder permisos o asignar módulos seleccionando directamente un Grupo o Etiqueta, propagándose a todos los rangos involucrados.
  * La pertenencia a un grupo o etiqueta no altera la estructura de subordinación definida en el diagrama de flechas de `[ORG-002]`.
* **Dependencias / Integración:** `[ORG-002]`.
* **Notas de UI/UX:** Selector de tags con autocompletado y filtros en el canvas para iluminar en tiempo real los nodos pertenecientes a un grupo o etiqueta seleccionada.

---

## 6. Políticas de Módulos y Gobernanza Empresarial

### [ORG-004] Directivas de Despliegue y Control de Marketplace Corporativo
* **Descripción:** Reglas definidas por el administrador para controlar la disponibilidad, adquisición y actualización de módulos dentro del perfil de la organización.
* **Alcance:** `API` | `Web` | `Desktop` | `Mobile (Android/iOS)`
* **Comportamiento clave:**
  * **Niveles de acceso a la Tienda:**
    * `Libre`: Los empleados pueden explorar e instalar cualquier módulo activado en la organización.
    * `Bajo Aprobación`: Los empleados ven los módulos pero deben emitir una solicitud formal de instalación (`[ORG-005]`).
    * `Bloqueada`: El icono de la tienda queda completamente oculto o deshabilitado para los colaboradores; solo el administrador gestiona los módulos instalados.
  * **Política de Actualizaciones:**
    * Modo `Automáticas Obligatorias`: El cliente descarga y aplica parches del módulo tan pronto como estén aprobados.
    * Modo `Versión Fijada`: La empresa define una versión específica de cada módulo y no se actualiza hasta que el administrador lo autorice.
  * **Aislamiento de Contexto (Tenant Sandboxing):**
    * Todas las restricciones de módulos, permisos y visibilidad aplican **únicamente** cuando el usuario tiene seleccionado el espacio de trabajo de dicha empresa (`[SHELL-001]`).
    * El perfil personal del usuario y sus perfiles en otras empresas no sufren alteraciones por las políticas de esta organización.
* **Dependencias / Integración:** `[STORE-001]`, `[STORE-002]`, `[SHELL-001]`.
* **Notas de UI/UX:** Panel en la consola de administración con switches de gobernanza claros y mensajes informativos cuando una acción esté bloqueada por política empresarial.

---

### [ORG-005] Flujo de Solicitud y Aprobación de Módulos
* **Descripción:** Circuito interactivo para tramitar peticiones de módulos cuando la organización opera bajo la modalidad de marketplace "Bajo Aprobación".
* **Alcance:** `API` | `Web` | `Desktop` | `Mobile (Android/iOS)`
* **Comportamiento clave:**
  * En la ficha del módulo de la tienda corporativa, el botón "Instalar" se reemplaza por **"Solicitar Acceso"**.
  * El empleado puede opcionalmente ingresar una justificación de uso.
  * La solicitud llega como una notificación interactiva con badge de alta prioridad a los usuarios con rango de aprobación administrativa (`[NOTIF-001]`).
  * El administrador puede **"Aprobar"** o **"Denegar"** con un solo clic.
  * Al aprobarse, el módulo se pone en cola de descarga automática en el perfil corporativo del solicitante y se le notifica la resolución.
* **Dependencias / Integración:** `[ORG-004]`, `[NOTIF-001]`, `[STORE-002]`.
* **Notas de UI/UX:** Estado visual en la tienda para el empleado solicitante: `Pendiente de Aprobación` (botón deshabilitado mientras se resuelve).

---

### [ORG-006] Preactivación y Homologación Obligatoria de Módulos en Tienda Corporativa
* **Descripción:** Mecanismo de control de seguridad que impide que un módulo del catálogo global aparezca en la tienda de la empresa hasta que haya sido explícitamente activado y preconfigurado por un administrador.
* **Alcance:** `API` | `Web` | `Desktop`
* **Comportamiento clave:**
  * **Visibilidad Condicionada:** Un módulo solo será visible en el catálogo de la organización para los empleados si cumple dos condiciones simultáneas:
    1. Haber sido habilitado en la lista blanca de la organización.
    2. Contar con sus permisos mínimos y parámetros obligatorios de configuración guardados por el administrador.
  * **Prevención de Errores por Omisión:** Si un módulo requiere parámetros de inicialización (ej. llaves de integración, URLs de webhook, esquemas de permisos obligatorios) y no han sido provistos, el sistema lo mantiene en estado `Incompleto / Borrador` y bloquea su visibilidad pública en el entorno corporativo.
  * **Desactivación de Emergencia:** El administrador puede deshabilitar temporalmente un módulo; al hacerlo, este desaparece de inmediato de la vista de la tienda y se suspende su ejecución para todos los empleados de la organización.
* **Dependencias / Integración:** `[STORE-001]`, `[ORG-004]`, `[PERM-001]`.
* **Notas de UI/UX:**
  * En el panel de administración de módulos, se muestran etiquetas claras de estado: `Sin Configurar (Oculto)`, `Listo (Visible en Tienda)`, `Inactivo`.
  * Asistente por pasos (*wizard*) para el administrador al habilitar un módulo nuevo: Paso 1: Configurar parámetros $\rightarrow$ Paso 2: Asignar permisos a rangos $\rightarrow$ Paso 3: Publicar en Tienda.

---

## 7. Matriz y Gestión de Permisos

### [PERM-001] Consola Central de Permisos por Rango
* **Descripción:** Módulo de administración para definir y personalizar el conjunto de permisos generales de la plataforma y permisos funcionales específicos asignados a cada rango del organigrama.
* **Alcance:** `API` | `Web` | `Desktop`
* **Comportamiento clave:**
  * **Permisos Generales de Plataforma:** Define privilegios globales independientes de los módulos (ej. invitar usuarios, ver logs de auditoría, modificar el organigrama visual, alterar políticas de tienda).
  * **Permisos Específicos por Módulo:** Permite desplegar el árbol de capacidades que expone cada módulo homologado y conmutar permisos individuales (ej. en un módulo de facturación: `Lectura`, `Creación de Facturas`, `Aprobación de Descuentos`, `Exportación de Reportes`).
  * **Herencia y Restricciones:** Posibilidad de que un rango subordinado herede automáticamente permisos de sus superiores o cuente con sobrescrituras específicas.
* **Dependencias / Integración:** `[ORG-002]`, `[ORG-003]`, `[CORE-001]`.
* **Notas de UI/UX:**
  * Vista de matriz/tabla comparativa donde las filas son capacidades/permisos y las columnas son los rangos de la empresa.
  * Casillas de verificación con guardado reactivo o botón de confirmación de cambios por lotes.

---

### [PERM-002] Inspector y Configuración de Permisos Contextual por Módulo
* **Descripción:** Panel accesible desde los ajustes propios de cada módulo que permite auditar y ajustar qué rangos tienen acceso y qué permisos específicos ostentan sobre dicha herramienta.
* **Alcance:** `API` | `Web` | `Desktop`
* **Comportamiento clave:**
  * **Bidireccionalidad de Gestión:** Permite al administrador ajustar permisos sin tener que desplazarse a la consola global de rangos (`[PERM-001]`).
  * **Visualización Focalizada:** Muestra la lista de todos los rangos del organigrama junto al desglose de las capacidades que tienen concedidas dentro de ese módulo en particular.
  * **Sincronización en Tiempo Real:** Cualquier ajuste realizado en este inspector actualiza de forma inmediata la matriz central de `[PERM-001]` y se refleja en el runtime de los clientes afectados.
* **Dependencias / Integración:** `[PERM-001]`, `[ORG-002]`, `[ORG-006]`.
* **Notas de UI/UX:**
  * Pestaña específica titulada "Permisos y Accesos" dentro del menú de ajustes o configuración del módulo.
  * Indicador visual de qué rangos no tienen acceso alguno al módulo para distinguirlos fácilmente de los rangos con acceso parcial o total.

---

## 8. Arquitectura Backend Modular, Homologación y Seguridad de Datos

### [BACK-001] Registro y Despliegue de Controladores Homologados en Tienda Oficial
* **Descripción:** Protocolo estricto de certificación y despliegue que impide la ejecución de binarios arbitrarios o ajenos a la tienda oficial. Cada controlador de módulo es verificado, firmado y confinado por la infraestructura de la API central.
* **Alcance:** `API` | `Marketplace Registry`
* **Comportamiento clave:**
  * **Prohibición de Binarios Externos:** Queda terminantemente vetada la carga manual (*side-loading*) de binarios o controladores no suministrados y auditados a través del registro oficial de la tienda.
  * **Espacio de Nombres de Ruta Reservado:** El controlador homologado asume la gestión exclusiva de los endpoints bajo el prefijo canónico `/api/v1/module/{module_id}/*`.
  * **Confinamiento de Ejecución:** El API Gateway valida que las peticiones entrantes contengan el token de atestación nominativa del usuario y tenant (`AuthContext`, `TenantId`) antes de permitir el enrutamiento al backend del módulo.
  * **Gestión de Esquemas de Base de Datos:**
    * El módulo declara sus esquemas y migraciones únicamente dentro de su espacio de nombres asignado (`mod_{module_id}_*`).
    * No se otorgan permisos de superusuario (`SUPERUSER` / `DBA`) a ningún módulo; todo cambio estructural se ejecuta bajo un rol con privilegios estrictamente acotados.
* **Dependencias / Integración:** `[STORE-001]`, `[STORE-003]`, API Gateway Reverse Proxy, Gestor de Base de Datos.
* **Notas de UI/UX:** Proceso de despliegue completamente transparente para el usuario final; alertas al administrador en caso de desajustes de versiones en el backend.

---

### [BACK-002] Aislamiento de Tablas y Gobernanza de Acceso Inter-Módulo
* **Descripción:** Mecanismo de seguridad y control de acceso que impide que el controlador de un módulo lea o modifique tablas de otros módulos salvo consentimiento expreso del usuario o política administrativa por defecto.
* **Alcance:** `API` | `Web` | `Desktop` | `Mobile (Android/iOS)`
* **Comportamiento clave:**
  * **Sandboxing por Defecto:** De forma predeterminada, el binario del módulo solo posee permisos DDL y DML sobre sus tablas propias (`mod_{module_id}_*`). Todo intento de consultar tablas de otro módulo (`mod_{other_id}_*`) es bloqueado por la capa de acceso a datos del host.
  * **Solicitud de Permiso Inter-Módulo:** Si un módulo requiere vincularse con datos de otro (ej. un módulo de reportes que necesita leer las tablas del módulo de inventario):
    1. Debe declarar explícitamente en su manifiesto las tablas y permisos solicitados (`read`, `write`, `execute`).
    2. En entornos personales, el usuario debe autorizar dicho acceso mediante un diálogo de consentimiento explícito.
  * **Delegación y Preconcesión Administrativa:** En perfiles corporativos (`[ORG-004]`), el administrador de la organización puede:
    * Otorgar este permiso de acceso transversal **por defecto** a nivel corporativo, evitando solicitarlo individualmente a cada empleado.
    * Revocar en cualquier momento el puente de datos entre módulos sin necesidad de desinstalar ninguna de las aplicaciones.
* **Dependencias / Integración:** `[BACK-001]`, `[PERM-001]`, `[AUTH-001]`, `[CORE-004]`.
* **Notas de UI/UX:**
  * Diálogo de advertencia claro al usuario/administrador: *"El módulo [A] solicita permiso para leer los datos del módulo [B] (Tablas: [lista]). ¿Deseas autorizarlo?"*.
  * Registro de auditoría para monitorizar consultas y accesos inter-módulo.

---

## 9. Distribución, DRM Nominativo e Integridad Criptográfica

### [STORE-003] Empaquetado, Firma y Atestación Criptográfica Nominativa por Perfil/Usuario
* **Descripción:** Mecanismo de compilación, sellado y licenciamiento dinámico mediante el cual la API genera y entrega paquetes de módulos sellados criptográficamente de forma irreductible para un único usuario, perfil y dispositivo.
* **Alcance:** `API` | `Web` | `Desktop` | `Mobile (Android/iOS)`
* **Comportamiento clave:**
  * **Sello Criptográfico Nominativo en Descarga:**
    * Al solicitar la descarga de un módulo, la API sintetiza un artefacto con una cabecera de atestación firmada con la clave privada de la plataforma.
    * Dicha atestación enlaza en un bloque no alterable: el identificador único de usuario (`UserID`), el identificador de perfil/organización (`WorkspaceID`) y la clave pública del enclave de hardware del dispositivo receptor (`HardwareAttestationToken`).
  * **Cifrado Específico de Bytecode:**
    * El código ejecutable del módulo se transfiere cifrado simétricamente con una clave efímera derivada del secreto protegido en el hardware local (`[SEC-002]`).
    * Un módulo descargado para un perfil resulta indescifrable y completamente inerte si es transferido a otro equipo, a otro usuario o a otro perfil dentro del mismo cliente.
  * **Verificación de Integridad Inquebrantable en Runtime:**
    * El Host Shell valida la firma criptográfica antes de montar el módulo en memoria y de forma periódica en segundo plano.
    * Cualquier intento de modificar bytes del archivo, retirar metadatos o suplantar el identificador de usuario destruye la validez del checksum criptográfico, provocando el rechazo y purga inmediata del paquete.
* **Dependencias / Integración:** `[CORE-002]`, `[AUTH-001]`, `[SEC-002]`, Servicio de Criptografía y Licenciamiento Central.
* **Notas de UI/UX:**
  * Cero fricción observable: el proceso de verificación y descifrado se realiza en memoria al momento de abrir el módulo.
  * Mensaje de seguridad informativo en caso de detección de artefactos foráneos o adulterados: *"El módulo instalado no coincide con la firma autorizada para este usuario"*.

---

## 10. Servicios y Workers en Segundo Plano (Desktop Runtime)

### [DESK-001] Worker de Seguridad y Detección de Amenazas en Runtime
* **Descripción:** Proceso en segundo plano desacoplado y de alta eficiencia que supervisa activamente el entorno del sistema operativo en el cliente de escritorio para identificar vectores de ataque como keyloggers o herramientas no autorizadas de control remoto sobre la aplicación.
* **Alcance:** `Desktop`
* **Comportamiento clave:**
  * **Monitoreo No Invasivo y Eficiente:** Inspección periódica y de bajo consumo de CPU/RAM sobre hooks globales de teclado (`SetWindowsHookEx`, `NSEvent monitors`, `X11/Wayland grabs`), inyecciones de DLLs/librerías y accesos directos de control remoto no autorizados a la ventana del host.
  * **Bloqueo Inmediato de Perfil (Lockdown):**
    * Al detectar una anomalía crítica o software espía confirmado, el worker suspende de inmediato la sesión y bloquea la interfaz de la aplicación.
    * Se revocan localmente los tokens activos en memoria para evitar la extracción de credenciales o datos sensibles.
  * **Desbloqueo Exclusivo por Administrador:**
    * El perfil bloqueado no puede ser rehabilitado por el propio usuario mediante contraseña habitual.
    * Requiere la intervención explícita de un usuario con rango administrativo corporativo (o clave de rescate del sistema) para evaluar el incidente y reactivar el acceso.
  * **Emisión de Evento Forense:** Envía un reporte seguro con metadatos del incidente (identificador del proceso sospechoso, timestamp, firma detectada) a la API de auditoría en cuanto haya conectividad disponible.
* **Dependencias / Integración:** `[AUTH-001]`, `[CORE-001]`, APIs nativas de bajo nivel de cada sistema operativo (Windows, macOS, Linux).
* **Notas de UI/UX:**
  * Pantalla completa de bloqueo de seguridad sin posibilidad de cierre accidental: *"Sesión bloqueada por alerta de seguridad. Contacte al administrador de su organización para reactivar su cuenta"*.

---

### [DESK-002] Worker de Servidor Local y Descubrimiento en Malla P2P
* **Descripción:** Proceso de red local embebido en el cliente de escritorio que opera como nodo de servidor y cliente P2P para descubrir pares en la misma subred (incluso sin conexión a internet) y coordinar comunicaciones directas para los módulos.
* **Alcance:** `Desktop`
* **Comportamiento clave:**
  * **Asignación de Puertos con Fallback:**
    * El worker intenta enlazar (*bind*) su servicio en un puerto TCP/UDP principal previamente reservado para la suite.
    * Si el puerto principal está ocupado por otra aplicación, intenta automáticamente en el segundo o tercer puerto de reserva (pool cerrado de 3 puertos específicos).
  * **Escaneo Inicial y Descubrimiento de Red:**
    * Al arrancar, inicia un barrido de la subred local consultando los 3 puertos reservados, operando de forma autónoma sin necesidad de conexión externa a internet.
    * **Coordinación y Cero Redundancia:** Al descubrir un nuevo equipo par (*peer*), ambos nodos intercambian su lista de equipos ya detectados. Se coordinan mediante tablas distribuidas para asegurar que ninguna IP sea escaneada más de dos veces.
  * **Topología en Malla y Verificación de Estado (Heartbeat):**
    * **Verificación Activa (Cada 1 minuto):** Envía sondas ligeras de tipo ping/heartbeat a los nodos conocidos para confirmar que siguen en línea; descarta de la tabla activa aquellos que dejen de responder.
    * **Reanálisis Global en Malla (Cada 10 minutos):** Ejecuta un ciclo coordinado de reescaneo completo para incorporar nuevos dispositivos que se hayan sumado a la red local.
  * **Infraestructura de Transporte para Módulos:**
    * Expone una API interna sobre el SDK Host (`[CORE-001]`) para que cualquier módulo con los permisos pertinentes pueda emitir o recibir flujos de datos punto a punto entre equipos de la red local sin pasar por la nube.
* **Dependencias / Integración:** `[CORE-001]`, `[CORE-004]`, `[BACK-002]`, Socket API nativa de red.
* **Notas de UI/UX:**
  * Indicador sutil de conectividad de malla en la barra de estado inferior (ej. icono de red local con contador de pares descubiertos: `"Red Local: 5 equipos conectados"`).
  * Sin ventanas emergentes intrusivas durante el escaneo ni interrupciones del hilo de renderizado principal (UI thread).

---

## 11. Seguridad Criptográfica, Transporte y Protección de Datos

### [SEC-001] Transporte Blindado contra Análisis de Tráfico (Padding Fijo y Cifrado Simétrico)
* **Descripción:** Protocolo de comunicación unificado para enlaces Cliente-Servidor y conexiones P2P en malla que aplica empaquetamiento a tamaño constante y cifrado robusto para impedir el análisis de firmas, metadatos y tamaño de mensajes.
* **Alcance:** `API` | `Web` | `Desktop` | `Mobile (Android/iOS)`
* **Comportamiento clave:**
  * **Bloques de Tamaño Fijo (Fixed-Frame Packaging):** Toda trama transmitida se serializa en bloques normalizados de longitud predeterminada (ej. múltiplos estrictos de 4 KB o 16 KB).
  * **Inyección de Relleno Criptográfico (Dummy Noise / Padding):**
    * Si la carga útil (*payload*) del mensaje es inferior al tamaño de bloque establecido, se rellena el espacio restante con bytes seudoaleatorios criptográficamente seguros (CSPRNG).
    * Al desencriptar el paquete en destino, la capa de red retira automáticamente el relleno antes de entregar los datos limpios al módulo o servicio destinatario.
  * **Cifrado Extremo a Extremo en Tránsito:**
    * Enlaces Cliente-Servidor: Encapsulado sobre TLS 1.3 con rotación de claves efímeras (ECDHE) y suites ChaCha20-Poly1305 o AES-256-GCM.
    * Canales P2P locales (`[DESK-002]`): Negociación de claves directas por par mediante protocolo Noise / Diffie-Hellman en curva Curve25519 con cifrado autenticado simétrico.
* **Dependencias / Integración:** `[DESK-002]`, API Gateway, capas criptográficas de red.
* **Notas de UI/UX:**
  * Ejecución totalmente imperceptible para el usuario; cero latencia adicional perceptible y total consistencia en el tráfico de red observable por herramientas externas.

---

### [SEC-002] Cifrado de Bases de Datos Locales Vinculado a Hardware (Anti-Extracción)
* **Descripción:** Mecanismo de blindaje de persistencia local en dispositivos que impide la apertura, extracción o inspección de datos fuera de la propia aplicación, aun si el archivo es sustraído físicamente.
* **Alcance:** `Desktop` | `Mobile (Android/iOS)`
* **Comportamiento clave:**
  * **Cifrado de Base de Datos en Reposo:** Motor de almacenamiento local completamente cifrado página por página utilizando AES-256-CBC o XChaCha20 con verificación HMAC (ej. esquema SQLCipher / SQLite Encryption Extension).
  * **Clave Derivada y Vinculada al Hardware (Hardware-Bound Key Derivation):**
    * La clave maestra de cifrado no se almacena en texto plano en ningún archivo, registro de configuración ni base de datos.
    * Se sintetiza en tiempo de ejecución combinando dos factores irreductibles:
      1. La credencial/PIN de acceso del usuario tratada con algoritmos de endurecimiento temporal y de memoria (Argon2id con coste alto de memoria).
      2. Una semilla criptográfica custodiada por el enclave de seguridad por hardware del equipo:
         * **iOS / macOS:** *Secure Enclave* vía Keychain con atributos de acceso estricto.
         * **Android:** *Android Keystore* con respaldo por hardware (*StrongBox Keymaster* / TEE).
         * **Windows Desktop:** Módulo de Plataforma Confiable (*TPM 2.0*) a través de CNG / DPAPI-NG.
         * **Linux Desktop:** *Kernel Keyrings* protegidos o TPM2-TSS.
  * **Inoperabilidad Fuera del Runtime:** Un volcado o copia del archivo de base de datos (`.db` / `.sqlite`) fuera del dispositivo original resulta matemáticamente indescifrable mediante inspectores, visores SQLite o herramientas forenses genéricas.
* **Dependencias / Integración:** `[AUTH-001]`, Enclaves seguros del SO (TPM, Secure Enclave, Keystore).
* **Notas de UI/UX:**
  * Proceso de desbloqueo instantáneo e imperceptible al validar la autenticación biométrica o PIN inicial del usuario.

---

### [SEC-003] Protección de Memoria Volátil y Bóveda Anti-Spyware de Credenciales
* **Descripción:** Conjunto de medidas de seguridad activa en memoria para blindar contraseñas maestras, tokens de autenticación y claves privadas contra volcados de memoria, lecturas no autorizadas o malware espía (*infostealers*).
* **Alcance:** `API` | `Web` | `Desktop` | `Mobile (Android/iOS)`
* **Comportamiento clave:**
  * **Ciclo de Vida Efímero y Purga Cero (Zeroize):**
    * Contraseñas en texto claro, pines y claves derivadas se conservan en memoria únicamente durante los microsegundos requeridos para el cómputo criptográfico.
    * Inmediatamente después, sus buffers de memoria son sobrescritos con ceros criptográficos (`SecureZeroMemory` / `memset_s`) para erradicar cualquier residuo en la memoria RAM liberada.
  * **Bloqueo contra Paginación en Disco (Memory Paging Protection):** En entornos de escritorio y móvil, los segmentos que alojan tokens de sesión y claves maestras activas se fijan en RAM mediante primitivas del sistema (`VirtualLock` en Windows, `mlock` en Unix/Linux/macOS), impidiendo que el sistema operativo escriba esa memoria en el archivo de intercambio (*pagefile/swap*) en disco.
  * **Defensa Anti-Inspección e Inyección de Memoria:**
    * Detección activa de depuradores adjuntos (*anti-debugging*: `IsDebuggerPresent`, `ptrace deny`) al manejar claves criptográficas.
    * Bloqueo contra lectura de memoria inter-proceso (`ReadProcessMemory` / `/proc/$pid/mem`).
  * **Rotación y Tokens de Vida Ultracorta:** Los tokens emitidos para la API (`AuthContext`) utilizan rotación continua con vigencias mínimas; si un token es sustraído, su ciclo de validez expira velozmente y cualquier intento de reutilización dispara la revocación de la cadena de confianza.
* **Dependencias / Integración:** `[AUTH-001]`, `[DESK-001]`, APIs de memoria segura del sistema operativo.
* **Notas de UI/UX:**
  * Transparente al usuario; en caso de que un proceso espía intente inyectar o leer la memoria del shell, se coordina con `[DESK-001]` para bloquear inmediatamente la sesión.

---

## 12. Motor de Personalización, Sistema de Diseño Host y Sandboxing Visual

### [UI-001] Gobernanza Dual de Estilos: Directiva Corporativa vs. Preferencia de Usuario
* **Descripción:** Mecanismo jerárquico de control estético donde el administrador de la organización define la estética y arquetipo visual obligatorio, mientras que el usuario conserva la facultad de elegir la paleta o tema cromático (*Claro*, *Oscuro*, *Alto Contraste*) dentro de las reglas de dicho arquetipo.
* **Alcance:** `API` | `Web` | `Desktop` | `Mobile (Android/iOS)`
* **Comportamiento clave:**
  * **Fijación de Arquetipo por Administrador:** En el perfil corporativo (`[SHELL-001]`), el administrador selecciona uno de los 10 arquetipos de diseño del sistema. Todos los colaboradores adoptan obligatoriamente la estética, tipografía base, radios de curvatura, bordes, elevación y estilo decorativo de dicho arquetipo.
  * **Elección de Tema por Empleado:** Cada usuario puede alternar entre las variantes cromáticas soportadas por el estilo activo (ej. `Modo Oscuro`, `Modo Claro`, `Modo Neutro/Sistema`).
  * **Aislamiento por Contexto:** Al alternar al perfil personal, el usuario puede seleccionar libremente tanto el arquetipo de estilo como el tema sin sujeción a la empresa.
* **Dependencias / Integración:** `[SHELL-001]`, `[ORG-004]`, servicio de persistencia de preferencias de usuario.
* **Notas de UI/UX:**
  * Selector en ajustes de perfil con previsualización interactiva en miniatura de cómo se reorganizan los elementos en cada tema.

---

### [UI-002] Catálogo Canónico de los 10 Arquetipos de Diseño (Interoperables y Visualmente Contrastantes)
* **Descripción:** Conjunto cerrado de 10 sistemas de diseño preintegrados en el Host Shell que transforman profundamente la apariencia visual, bordes, elevaciones, tipografías, ritmos y micro-interacciones de la suite, garantizando compatibilidad estructural total bajo un contrato semántico unificado de layout.
* **Alcance:** `Web` | `Desktop` | `Mobile (Android/iOS)`
* **Comportamiento clave:**
  * **Contrato Semántico y Compatibilidad Absoluta:**
    * Los 10 arquetipos respetan la misma cuadrícula espacial y jerarquía de componentes del Host. Ningún arquetipo rompe la posición funcional ni la lógica de los datos de un módulo; la diferenciación es estética, textural y de lenguaje visual profundo.
  * **Los 10 Arquetipos Preintegrados:**
    1. **Modern Dark (Cyber / High-Tech):** Superficies oscuras en capas de acrílico, sin bordes duros (*borderless*), con sutil iluminación en bordes activos y tipografía monoespaciada para metadatos.
    2. **Chromatic Playful (Colorido / Dinámico):** Acentos cromáticos vivos diferenciados por sección, bordes sumamente redondeados ($16\text{ px} - 24\text{ px}$), sombras difusas suaves y micropulsos en elementos interactivos.
    3. **Executive Serious (Corporativo Sobrio):** Máxima sobriedad y concentración analítica; líneas de separación milimétricas ($1\text{ px}$), esquinas cuadradas ($0\text{ px} - 2\text{ px}$), contrastes fríos y tipografía neutra sans-serif.
    4. **Classic Retro (Desktop Tradicional):** Estética inspirada en interfaces clásicas de escritorio; barras de herramientas con biseles, botones con relieve tradicional y texturas sólidas sin gradientes complejos.
    5. **Neumorphic Soft (Relieve Suave):** Interfaz táctil simulada mediante sombras dobles cóncavas y convexas, sensación de extrusión física sobre la superficie y contraste lumínico balanceado.
    6. **Minimal Clean (Swiss Typographic):** Espacios en blanco generosos, ausencia total de gradientes o sombras, estructuración mediante pesos y tamaños tipográficos y grillas geométricas puras.
    7. **Industrial Technical (Console / Data-Heavy):** Rejillas visibles de alta densidad, bordes técnicos rectos, estética de terminal de datos y optimización visual para inspección rápida de valores numéricos.
    8. **Glassmorphic Luxe (Translúcido / Frost):** Paneles semitransparentes con desenfoque de fondo dinámico (*backdrop-filter*), reflejos angulares y acabados satinados.
    9. **Editorial Paper (Documental / Warm):** Fondos en tonalidades crema/papel cálido, tipografías con serifa en encabezados, líneas de separación con remates editoriales y sensación de lectura en soporte físico.
    10. **Material Expressive (Card & Surface Centric):** Tarjetas con elevaciones marcadas, comportamiento elástico reactivo a la interacción y botones de acción flotantes integrados.
  * **Variantes Cromáticas:** Cada arquetipo incluye 4 variantes cromáticas internas: `Dark`, `Light`, `System / Auto` y `High Contrast (WCAG AAA)`.
* **Dependencias / Integración:** `[CORE-001]`, motor de renderizado CSS/Canvas nativo.
* **Notas de UI/UX:**
  * Cambio instantáneo de estilo sin parpadeos ni recarga de página: la app simplemente actualiza el árbol de tokens y la capa visual del host.

---

### [UI-003] Kit Canónico de Componentes Core Host (Componentes Headless / Themeable)
* **Descripción:** Biblioteca nativa y exclusiva de componentes de interfaz que el Host Shell suministra de forma obligatoria a todos los módulos para suprimir completamente la necesidad de código CSS o frameworks como Tailwind en el código del módulo.
* **Alcance:** `Web` | `Desktop` | `Mobile (Android/iOS)`
* **Comportamiento clave:**
  * **Prohibición de Estilos Propios en Módulos:** El empaquetado del frontend de los módulos no debe compilar CSS, Tailwind, Styled Components ni reglas visuales atómicas; únicamente consume los componentes semánticos exportados por el SDK Host (`@host/ui`).
  * **Inyección Transparente de Estilo:** Cada componente del kit se renderiza automáticamente según las directivas temáticas del arquetipo activo en `[UI-002]`.
  * **Catálogo de Componentes Base Suministrados:**
    * **Entrada de Datos (Inputs):** `TextInput`, `PasswordInput`, `TextArea`, `NumberStepper`, `SelectDropdown`, `SearchCombobox`, `DatePicker`, `DateRangePicker`, `Checkbox`, `RadioGroup`, `SwitchToggle`, `SliderRange`, `TagInput`, `FileUploadDropzone`.
    * **Visualización de Datos y Tablas:** `DataTable` (con paginación, ordenamiento, filtrado y columnas redimensionables integradas), `DataGrid`, `VirtualList` (para millones de registros), `StatCard`, `BadgeChip`, `Timeline`, `TreeView`, `KeyValDisplay`.
    * **Disposición y Layout:** `Container`, `GridRow`, `GridCol`, `CardPanel`, `Divider`, `ScrollArea`, `SplitPane`, `AccordionGroup`, `TabContainer`.
    * **Acción y Diálogo:** `Button`, `IconButton`, `ButtonGroup`, `ModalDialog`, `DrawerSheet`, `DropdownMenu`, `ContextMenu` (click derecho nativo en Desktop/Web), `Tooltip`, `Popover`.
    * **Retroalimentación y Estado:** `ProgressBar`, `CircularProgress`, `SkeletonPlaceholder`, `AlertBanner`, `ToastNotification`, `EmptyStatePlaceholder`.
* **Dependencias / Integración:** `[CORE-001]`, `[CORE-002]`.
* **Notas de UI/UX:**
  * El comportamiento de interacción (foco por teclado, accesibilidad ARIA, soporte táctil) está gestionado uniformemente por el Host, garantizando calidad idéntica en toda la suite.

---

### [UI-004] Escape Hatch para Desarrolladores y Sandboxing Visual Aislado (Developer Custom UI)
* **Descripción:** Contenedor específico provisto por el SDK Host que permite al desarrollador de módulos renderizar componentes personalizados o no existentes en el kit del core, encapsulando sus propios estilos y asumiendo una apariencia fija invariable frente a los 10 arquetipos de diseño del sistema.
* **Alcance:** `Web` | `Desktop` | `Mobile (Android/iOS)`
* **Comportamiento clave:**
  * **Autonomía del Desarrollador para Casos Especiales:** Si un módulo requiere un elemento no disponible en el catálogo de `@host/ui`, o cuya integración en el core no resulta técnicamente rentable o prioritaria, el desarrollador del módulo puede construirlo directamente dentro del componente contenedor `<HostCustomSandbox>`.
  * **Invarianza Estilística frente a los 10 Arquetipos:**
    * Los elementos renderizados dentro de este sandbox **no mutan dinámicamente** con los 10 estilos corporativos ni adoptan sus directivas espaciales.
    * El desarrollador define la apariencia exacta del componente, asumiendo que se visualizará con el mismo diseño estático e inalterado en cualquier empresa o tema.
  * **Barrera de Contención Bidireccional (CSS Sandboxing):**
    * Implementado mediante *Shadow DOM* estricto en Web/Desktop y contenedores de vista aislados en Mobile.
    * Los estilos inyectados por el desarrollador para su componente ad-hoc no pueden fugarse ni romper la interfaz del Host Shell ni de otros módulos.
    * Las variables de estilo y fuentes del arquetipo corporativo no interfieren en el cálculo interno del componente personalizado.
  * **Declaración Obligatoria en Manifiesto:** Todo módulo que haga uso de componentes personalizados fuera del estándar de `@host/ui` debe declararlo formalmente en su manifiesto de publicación para auditoría técnica de compatibilidad.
* **Dependencias / Integración:** `[CORE-001]`, `[UI-003]`, `[STORE-001]`.
* **Notas de UI/UX:**
  * El contenedor gestiona automáticamente los límites de scroll y escalado espacial para que el elemento personalizado del desarrollador no deforme el layout general de la aplicación.

---