/**
 * SplashIOS — telas de abertura do PWA no iPhone (Aldo 17/10/2026).
 *
 * Sem isto o iOS abre o app instalado numa tela BRANCA até o Next montar. O Android usa o
 * manifest (background_color + ícone) e não precisa disso; o Safari ignora o manifest e exige
 * `apple-touch-startup-image` com uma media query por resolução — daí a lista na mão.
 *
 * As imagens vêm de public/splash, geradas da logo da Track sobre o #f5f6f8 do painel. Resolução
 * que não estiver aqui simplesmente cai no branco de antes: não quebra nada, só não tem splash.
 * É Server Component de propósito — são só <link>, não precisa de JS no cliente.
 */
const TELAS = [
  [1320, 2868], [1290, 2796], [1284, 2778], [1206, 2622], [1179, 2556],
  [1170, 2532], [1242, 2688], [1125, 2436], [828, 1792], [750, 1334],
] as const

export default function SplashIOS() {
  return (
    <>
      {TELAS.map(([w, h]) => {
        const dpr = w >= 1125 ? 3 : 2
        return (
          <link
            key={`${w}x${h}`}
            rel="apple-touch-startup-image"
            href={`/splash/${w}x${h}.png`}
            media={`(device-width: ${w / dpr}px) and (device-height: ${h / dpr}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)`}
          />
        )
      })}
    </>
  )
}
