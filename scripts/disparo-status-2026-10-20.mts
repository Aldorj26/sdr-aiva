// Foto do disparo D+0 de hoje — o mesmo que o comando /disparo do WhatsApp responde — só leitura.
// Uso: npx tsx --env-file=.env.local scripts/disparo-status-2026-10-20.mts
import { fotoRapida, resumoDoDia } from '../lib/disparo-diario'
import { conferirEntregaHoje } from '../lib/entrega-meta'

const foto = await fotoRapida()
console.log('FOTO:', JSON.stringify(foto))
const entrega = await conferirEntregaHoje()
console.log('ENTREGA:', JSON.stringify(entrega))
const resumo = await resumoDoDia(Date.now(), entrega as never)
console.log('RESUMO:', JSON.stringify(resumo, null, 1))
