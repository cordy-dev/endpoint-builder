# Редизайн библиотеки @cordy/endpoint-builder

**Дата:** 2026-01-22
**Статус:** Approved

## Цель

Переосмыслить библиотеку как типобезопасный HTTP-клиент с runtime валидацией, ориентированный на лучший Developer Experience.

## Ключевые решения

- **Типобезопасность**: Compile-time типы + runtime валидация
- **Валидация**: Standard Schema (поддержка zod/valibot/arktype)
- **API стиль**: Минималистичный с опциональными цепочками
- **Path параметры**: Автоматический вывод типов из строки
- **Error handling**: Throw по умолчанию + `.safe()` для Result type
- **Фокус**: DX прежде всего

---

## API Design

### 1. Создание клиента

```typescript
import { createClient } from '@cordy/endpoint-builder'

// Минимальный
const api = createClient({ baseUrl: 'https://api.example.com' })

// С опциями
const api = createClient({
  baseUrl: 'https://api.example.com',
  auth: 'Bearer token',
  timeout: 30000,
  retry: true,
  headers: { 'X-App': 'MyApp' },
  unwrap: (response) => response.data  // для API с оберткой
})
```

### 2. Базовые запросы

```typescript
import { z } from 'zod'

const User = z.object({ id: z.number(), name: z.string() })

// GET с path параметрами
const user = await api.get('/users/:id', { params: { id: 1 } }).schema(User)

// POST с body
const created = await api.post('/users', {
  body: { name: 'John', email: 'john@example.com' }
}).schema(User)

// Query параметры
const users = await api.get('/users', {
  query: { page: 1, limit: 20 }
}).schema(z.array(User))
```

### 3. Переопределение опций

```typescript
// В объекте параметров
const data = await api.get('/public', { auth: false }).schema(Data)

// Через цепочку
const data = await api.get('/slow')
  .timeout(60000)
  .retry(5)
  .schema(Data)

// Комбинация
const result = await api
  .post('/upload', { timeout: 60000 })
  .body(formData)
  .noAuth()
  .schema(UploadResult)
```

---

## Аутентификация

### Простые случаи

```typescript
// Bearer токен
const api = createClient({ baseUrl: '...', auth: 'my-token' })

// API Key
const api = createClient({
  baseUrl: '...',
  auth: { type: 'apiKey', key: 'secret', header: 'X-API-Key' }
})

// Basic auth
const api = createClient({
  baseUrl: '...',
  auth: { type: 'basic', username: 'user', password: 'pass' }
})
```

### Продвинутые стратегии

```typescript
import { bearerAuth, refreshAuth } from '@cordy/endpoint-builder/auth'

// Динамический токен
const api = createClient({
  baseUrl: '...',
  auth: bearerAuth(() => getTokenFromStore())
})

// С автоматическим refresh
const api = createClient({
  baseUrl: '...',
  auth: refreshAuth({
    getToken: () => storage.get('access_token'),
    getRefreshToken: () => storage.get('refresh_token'),
    refresh: async (refreshToken) => {
      const { access, refresh } = await authApi.refresh(refreshToken)
      storage.set('access_token', access)
      storage.set('refresh_token', refresh)
      return access
    },
    shouldRefresh: (response) => response.status === 401
  })
})
```

### Кастомная стратегия

```typescript
import type { AuthStrategy } from '@cordy/endpoint-builder/auth'

const hmacAuth: AuthStrategy = {
  async prepare(request) {
    const timestamp = Date.now().toString()
    const signature = await sign(request.url, timestamp, SECRET)
    return {
      headers: { 'X-Timestamp': timestamp, 'X-Signature': signature }
    }
  },
  async onError(response, retry) {
    if (response.status === 401) {
      await refreshCredentials()
      return retry()
    }
    return null
  }
}
```

---

## Валидация

### Response валидация

```typescript
import { z } from 'zod'

const User = z.object({ id: z.number(), name: z.string() })

// Валидация response
const user = await api.get('/users/:id', { params: { id: 1 } }).schema(User)
```

### Body валидация

```typescript
const CreateUser = z.object({
  name: z.string().min(1),
  email: z.string().email()
})

// Валидирует body ДО отправки
const user = await api
  .post('/users', { body: { name: 'John', email: 'john@example.com' } })
  .bodySchema(CreateUser)
  .schema(User)
```

### Safe mode

```typescript
const { data, error } = await api
  .get('/users/:id', { params: { id: 1 } })
  .schema(User)
  .safe()

if (error) {
  if (error.type === 'validation') {
    console.log(error.issues)
  } else if (error.type === 'http') {
    console.log(error.status)
  } else if (error.type === 'network') {
    console.log(error.cause)
  }
  return
}

console.log(data.name)  // data: User
```

### Transform

```typescript
const user = await api
  .get('/users/:id', { params: { id: 1 } })
  .schema(User)
  .transform(user => ({ ...user, displayName: user.name.toUpperCase() }))
```

---

## Response Unwrapping

Для API возвращающих данные в обертке `{ data: {...}, meta: {...} }`:

```typescript
const api = createClient({
  baseUrl: '...',
  unwrap: (response) => response.data
})

// Получаете чистые данные
const user = await api.get('/users/:id', { params: { id: 1 } }).schema(User)

// Отключить для конкретного запроса
const raw = await api.get('/legacy').unwrap(false).schema(LegacyResponse)

// Свой unwrap для запроса
const items = await api.get('/paginated').unwrap(r => r.items).schema(z.array(Item))
```

---

## Error Handling и Retry

### Типы ошибок

```typescript
import { HttpError, ValidationError, NetworkError } from '@cordy/endpoint-builder'

try {
  const user = await api.get('/users/:id', { params: { id: 1 } }).schema(User)
} catch (e) {
  if (e instanceof ValidationError) {
    console.log(e.issues, e.received)
  } else if (e instanceof HttpError) {
    console.log(e.status, e.response)
  } else if (e instanceof NetworkError) {
    console.log(e.cause)
  }
}
```

### Retry

```typescript
// Простой
const api = createClient({ baseUrl: '...', retry: 3 })

// С настройками
const api = createClient({
  baseUrl: '...',
  retry: {
    attempts: 3,
    delay: 1000,
    maxDelay: 30000,
    backoff: 'exponential',
    jitter: true,
    retryOn: [408, 429, 500, 502, 503, 504]
  }
})

// Переопределение
await api.post('/payments', { body: payment, retry: false }).schema(Receipt)
await api.get('/flaky').retry({ attempts: 10 }).schema(Data)
```

### Кастомная retry стратегия

```typescript
import type { RetryStrategy } from '@cordy/endpoint-builder/retry'

const customRetry: RetryStrategy = {
  shouldRetry(context) {
    if (context.attempt >= 5) return false
    if (context.response?.status === 429) return true
    return context.error instanceof NetworkError
  },
  getDelay(context) {
    const retryAfter = context.response?.headers.get('Retry-After')
    if (retryAfter) return parseInt(retryAfter) * 1000
    return Math.min(1000 * Math.pow(2, context.attempt), 30000)
  }
}
```

---

## Path Parameters

### Автоматический вывод типов

```typescript
// TS извлекает параметры из строки
await api.get('/users/:id', { params: { id: 1 } })
//                                     ^? { id: string | number }

await api.get('/users/:userId/posts/:postId', {
  params: { userId: 1, postId: 5 }
})

// Ошибка компиляции если забыли параметр
await api.get('/users/:id', { params: {} })  // ❌ Property 'id' is missing
```

### Type-safe URL builder

```typescript
import { path } from '@cordy/endpoint-builder'

const userPath = path('/users/:id')
const url = userPath({ id: 1 })  // '/users/1'
```

---

## Interceptors

```typescript
const api = createClient({
  baseUrl: '...',
  interceptors: {
    request: [
      (config) => ({
        ...config,
        headers: { ...config.headers, 'X-Timestamp': Date.now().toString() }
      })
    ],
    response: [
      (response) => {
        console.log(`← ${response.status}`)
        return response
      }
    ]
  }
})

// Динамически
const remove = api.interceptors.request.use((config) => config)
remove()  // удалить
```

---

## Экспорты

```typescript
// Основной
import { createClient, path } from '@cordy/endpoint-builder'

// Auth
import { bearerAuth, refreshAuth, apiKeyAuth, basicAuth } from '@cordy/endpoint-builder/auth'
import type { AuthStrategy } from '@cordy/endpoint-builder/auth'

// Errors
import { HttpError, ValidationError, NetworkError } from '@cordy/endpoint-builder/errors'

// Types
import type { RetryStrategy, RequestConfig, Response } from '@cordy/endpoint-builder'
```

---

## Отличия от конкурентов

| Фича | endpoint-builder | ky | ofetch | axios |
|------|------------------|----|----|-------|
| Standard Schema | ✅ | ❌ | ❌ | ❌ |
| Path params typing | ✅ | ❌ | ❌ | ❌ |
| Body validation | ✅ | ❌ | ❌ | ❌ |
| Safe mode (Result) | ✅ | ❌ | ❌ | ❌ |
| Response unwrap | ✅ | ❌ | ❌ | ❌ |
| Zero deps | ✅ | ✅ | ✅ | ❌ |
| TypeScript-first | ✅ | ✅ | ✅ | partial |
