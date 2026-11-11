import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const clientRoot = new URL('../src/', import.meta.url)
const readSource = (path) => readFile(new URL(path, clientRoot), 'utf8')

test('login password visibility control keeps the password controlled and does not submit the form', async () => {
  const login = await readSource('pages/Login.jsx')

  assert.match(login, /const \[showPassword, setShowPassword\] = useState\(false\)/)
  assert.match(login, /type=\{showPassword \? 'text' : 'password'\} value=\{form\.password\}/)
  assert.match(login, /onChange=\{handleChange\}/)
  assert.match(login, /aria-label=\{showPassword \? 'Hide password' : 'Show password'\}/)
  assert.match(login, /aria-pressed=\{showPassword\}/)
  assert.match(login, /onClick=\{\(\) => setShowPassword\(\(visible\) => !visible\)\}/)
  assert.match(login, /className="password-visibility-toggle"[\s\S]*?type="button"/)
  assert.match(login, /<form onSubmit=\{handleSubmit\}/)
  assert.match(login, /await login\(\{ username, password: form\.password \}\)/)
})

test('sidebar logout keeps its handler and uses the shared navigation styling and accessible icon', async () => {
  const sidebar = await readSource('components/DashboardSidebar.jsx')
  const styles = await readSource('index.css')

  assert.match(sidebar, /const handleLogout = \(\) => \{\s*logout\(\)\s*navigate\('\/login', \{ replace: true \}\)/)
  assert.match(sidebar, /<button className="sidebar-link sidebar-logout" onClick=\{handleLogout\} type="button">/)
  assert.match(sidebar, /<svg aria-hidden="true"[\s\S]*?<span>Log out<\/span>/)
  assert.match(styles, /\.sidebar-logout:hover \{ background: rgba\(255,255,255,\.1\); color: #fff; \}/)
  assert.match(styles, /\.sidebar-logout:focus-visible/)
  assert.match(styles, /@media \(max-width: 767\.98px\)[\s\S]*\.dashboard-sidebar-open/)
})
