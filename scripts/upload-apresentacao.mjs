#!/usr/bin/env node
/**
 * Sobe a apresentação AIVA pro Supabase Storage (bucket público), gerando um
 * link DIRETO e neutro — desacoplado do domínio do painel (sdr-agente.vercel.app).
 * Lê SUPABASE_URL + SERVICE_ROLE_KEY do .env.local. Idempotente.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// .env.local loader
const env = {}
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const BUCKET = 'aiva-publico'
const FILE = 'AIVA_2026.pdf'
const localPath = path.join(ROOT, 'public', FILE)

// 1) garante bucket público
{
  const { error } = await sb.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: '20MB',
    allowedMimeTypes: ['application/pdf'],
  })
  if (error && !/already exists|exists/i.test(error.message)) throw error
}

// 2) upload (upsert)
{
  const buffer = fs.readFileSync(localPath)
  const { error } = await sb.storage.from(BUCKET).upload(FILE, buffer, {
    contentType: 'application/pdf', upsert: true,
  })
  if (error) throw new Error(`Upload falhou: ${error.message}`)
}

// 3) URL pública
const { data } = sb.storage.from(BUCKET).getPublicUrl(FILE)
console.log('✅ Apresentação publicada (link neutro, sem relação com o painel):')
console.log(data.publicUrl)
