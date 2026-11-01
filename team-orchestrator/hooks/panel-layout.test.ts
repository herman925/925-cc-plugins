import {expect,test} from 'claude-code/testing'
import {panelSettings,rightPanelHint} from './panel-layout'

test('new and legacy card settings default to right placement without losing card preferences',()=>{
 expect(panelSettings(undefined).placement).toBe('right')
 const legacy=panelSettings({layout:'stacked',chart:false,hide:['MODEL']})
 expect(legacy.placement).toBe('right');expect(legacy.layout).toBe('stacked');expect(legacy.chart).toBe(false);expect(legacy.hide).toEqual(['MODEL'])
 expect(panelSettings({layout:'dock'}).layout).toBe('columns')
 expect(panelSettings({placement:'inline',layout:'columns'}).placement).toBe('inline')
})
test('host fallback explains classic versus narrow-fullscreen without a false placement promise',()=>{
 expect(rightPanelHint({columns:180,isFullscreen:false})).toContain('classic renderer')
 expect(rightPanelHint({columns:180,isFullscreen:false})).toContain('user-wide')
 expect(rightPanelHint({columns:90,isFullscreen:true})).toContain('Widen the terminal')
 expect(rightPanelHint({columns:180,isFullscreen:true})).toContain('host currently seats')
 expect(rightPanelHint()).toContain('fullscreen layout')
 expect(rightPanelHint({columns:180,isFullscreen:true},true)).toContain('waiting for host placement')
 expect(rightPanelHint({columns:180,isFullscreen:true},true)).not.toContain('seats it inline')
})
