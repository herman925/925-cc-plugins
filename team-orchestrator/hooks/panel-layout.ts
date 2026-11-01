import type {Settings} from '../types'

export const PANEL_SETTINGS0:Settings={placement:'right',layout:'stacked',chart:true,hide:[]}
export function panelSettings(value:Partial<Settings>|null|undefined):Settings{
 const current={...PANEL_SETTINGS0,...value}
 return {...current,placement:current.placement==='inline'?'inline':'right',layout:current.layout==='dock'?'columns':current.layout}
}
// These are host facts from ui.render, never settings writes or placement overrides.
export function rightPanelHint(viewport?:{columns?:number;isFullscreen?:boolean},unplaced=false):string{
 const status=unplaced?'Right panel is waiting for host placement; controls are shown here.':'Right panel requested; the host currently seats it inline.'
 if(viewport?.isFullscreen===false)return `${status} The host uses its classic renderer. Right docking needs fullscreen and at least 110 columns. The host /tui command changes the user-wide renderer preference and requires a restart.`
 if(viewport?.isFullscreen===true&&typeof viewport.columns==='number'&&viewport.columns<110)return `${status} This terminal is ${viewport.columns} columns wide; right docking needs at least 110. Widen the terminal. Your right-panel preference is kept.`
 return `${status} Docking beside the transcript requires the fullscreen layout and at least 110 terminal columns.`
}
