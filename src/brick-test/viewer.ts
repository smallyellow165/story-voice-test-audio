import {ProfileInteraction,type DebugInstance,type DebugPose,type DebugScene} from './profile-interaction'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { LDrawLoader } from 'three/addons/loaders/LDrawLoader.js'
import { LDrawConditionalLineMaterial } from 'three/addons/materials/LDrawConditionalLineMaterial.js'
import { BODY_LDU, MM_PER_LDU, STUD_LDU, geometrySupport } from './catalog'
import type { Brick } from './catalog'
import type { PartGeometry, Connector } from './part-geometry'
import type { Candidate } from './assembly'

// No React, routing, or app-service dependency: mount in any sized DOM element.
export class BrickViewer {
  private profileLayer = new THREE.Group()
  private profileOverlay: HTMLDivElement | null = null
  private profileLabels: {element:HTMLElement;point:THREE.Vector3;owner?:THREE.Object3D}[] = []
  private profileEditing:ProfileInteraction|null=null
  private profileBindings:{layer:THREE.Group;owner:THREE.Object3D}[]=[]
  private profileResources: {dispose():void}[] = []
  private buildMotion: {members:{object:THREE.Object3D;position:THREE.Vector3;quaternion:THREE.Quaternion}[];pivot:THREE.Vector3;offset:THREE.Vector3;startRotation:THREE.Quaternion;started:number|null;duration:number;done:()=>void} | null = null
  private buildArrow: THREE.ArrowHelper | null = null
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000)
  private renderer: THREE.WebGLRenderer
  private controls: OrbitControls
  private assembly = new THREE.Group()
  private observer: ResizeObserver
  private templates = new Map<string, Promise<THREE.Group>>()
  private geometries = new Set<THREE.BufferGeometry>()
  private materials = new Set<THREE.Material>()
  private highlightIds: string[] = []
  private debugMaterials = new Set<THREE.Material>()
  private originalMaterials = new Map<THREE.Mesh | THREE.LineSegments, THREE.Material | THREE.Material[]>()
  private disposed = false
  private revision = 0
  private frame = 0
  private host: HTMLElement
  private libraryUrl: string
  private onFatal: (message: string) => void
  private markers = new THREE.Group()
  private preview = new THREE.Group()
  private previewRevision = 0
  private previewMaterials = new Set<THREE.Material>()
  private markerGeometry = new THREE.SphereGeometry(2.4, 12, 8)
  private markerMaterial = new THREE.MeshBasicMaterial({ color: 0x207cbb, transparent: true, depthTest: false, depthWrite: false })
  private selectedMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0xe08316, transparent: true, depthTest: false, depthWrite: false })
  private pickCandidate: ((key: string) => void) | null = null
  private pointerStart: { id: number; x: number; y: number; dragged: boolean } | null = null

  constructor(host: HTMLElement, libraryUrl: string, onFatal: (message: string) => void) {
    this.host = host
    this.libraryUrl = libraryUrl.endsWith('/') ? libraryUrl : `${libraryUrl}/`
    this.onFatal = onFatal
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.domElement.setAttribute('aria-label', 'DUPLO 三维模型：左键旋转，滚轮缩放，右键平移')
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost)
    host.append(this.renderer.domElement)
    this.scene.background = new THREE.Color('#edf1f5')
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x657185, 2.5))
    const key = new THREE.DirectionalLight(0xffffff, 3)
    key.position.set(120, 250, 160)
    this.scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 1.5)
    fill.position.set(-160, 80, -100)
    this.scene.add(fill, this.assembly, this.markers, this.preview, this.profileLayer)
    this.renderer.domElement.addEventListener('pointerdown', this.pointerDown)
    this.renderer.domElement.addEventListener('pointermove', this.pointerMove)
    this.renderer.domElement.addEventListener('pointerup', this.pointerUp)
    this.renderer.domElement.addEventListener('pointercancel', this.pointerCancel)
    const grid = new THREE.GridHelper(640, 40, 0x9aaabe, 0xd2dae4)
    grid.position.y = -0.15
    this.scene.add(grid)
    this.track(grid)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.minDistance = 5
    this.controls.maxDistance = 4000
    this.controls.maxPolarAngle = Math.PI // Permit underside inspection.
    this.home()
    this.observer = new ResizeObserver(this.resize)
    this.observer.observe(host)
    this.resize()
    this.animate()
  }

  private contextLost = (event: Event) => {
    event.preventDefault()
    this.onFatal('WebGL 上下文已丢失，请刷新页面重新加载模型。')
  }

  private pointerDown = (event: PointerEvent) => {
    if (event.button === 0 && event.isPrimary) this.pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false }
    else this.pointerStart = null
  }

  private pointerMove = (event: PointerEvent) => {
    const start = this.pointerStart
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) start.dragged = true
  }

  private pointerCancel = () => { this.pointerStart = null }

  private pointerUp = (event: PointerEvent) => {
    const start = this.pointerStart
    this.pointerStart = null
    if (!start || start.id !== event.pointerId || start.dragged || event.button !== 0 || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ray = new THREE.Raycaster()
    this.camera.updateMatrixWorld()
    this.markers.updateMatrixWorld(true)
    ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), this.camera)
    const hit = ray.intersectObjects(this.markers.children, false)[0]
    if (hit) this.pickCandidate?.(hit.object.userData.candidateKey)
  }

  // Markers are UI handles, never replacement brick geometry.
  showCandidates(candidates: Candidate[], selected: string | null, onPick: (key: string) => void) {
    this.markers.clear()
    this.pickCandidate = onPick
    for (const candidate of candidates) {
      const marker = new THREE.Mesh(this.markerGeometry, candidate.key === selected ? this.selectedMarkerMaterial : this.markerMaterial)
      marker.position.set(candidate.brick.x * STUD_LDU * MM_PER_LDU, candidate.brick.layer * BODY_LDU * MM_PER_LDU + 10, candidate.brick.z * STUD_LDU * MM_PER_LDU)
      marker.userData.candidateKey = candidate.key
      marker.renderOrder = 10
      this.markers.add(marker)
    }
  }

  clearCandidates() {
    this.markers.clear()
    this.pickCandidate = null
  }

  clearPreview() {
    ++this.previewRevision
    this.preview.clear()
    this.previewMaterials.forEach((material) => material.dispose())
    this.previewMaterials.clear()
  }

  async showPreview(bricks: Brick[]): Promise<void> {
    this.clearPreview()
    const revision = this.previewRevision
    const models = await Promise.all(bricks.map((brick) => this.template(brick.part, brick.color)))
    if (this.disposed || revision !== this.previewRevision) return
    const clones = new Map<THREE.Material, THREE.Material>()
    const ghostMaterial = (material: THREE.Material) => {
      let clone = clones.get(material)
      if (!clone) {
        clone = material.clone()
        clone.transparent = true
        clone.opacity = 0.35
        clone.depthWrite = false
        clones.set(material, clone)
        this.previewMaterials.add(clone)
      }
      return clone
    }
    bricks.forEach((brick, index) => {
      const object = models[index].clone(true)
      object.traverse((node) => {
        const renderable = node as THREE.Mesh
        if (renderable.material) renderable.material = Array.isArray(renderable.material) ? renderable.material.map(ghostMaterial) : ghostMaterial(renderable.material)
      })
      object.position.set(brick.x * STUD_LDU * MM_PER_LDU, brick.layer * BODY_LDU * MM_PER_LDU, brick.z * STUD_LDU * MM_PER_LDU)
      object.rotation.y = THREE.MathUtils.degToRad(brick.rotation)
      this.preview.add(object)
    })
  }

  private resize = () => {
    const width = Math.max(this.host.clientWidth, 1)
    const height = Math.max(this.host.clientHeight, 1)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }

  private animate = () => {
    if (this.disposed) return
    this.frame = requestAnimationFrame(this.animate)
    this.controls.update()
    this.updateBuildMotion()
    this.profileEditing?.update()
    for(const {layer,owner} of this.profileBindings){layer.position.copy(owner.position);layer.quaternion.copy(owner.quaternion)}
    this.renderer.render(this.scene, this.camera)
    for(const label of this.profileLabels){const point=label.owner?label.owner.localToWorld(label.point.clone()):label.point.clone();const p=point.project(this.camera);label.element.style.left=((p.x+1)/2*this.host.clientWidth)+'px';label.element.style.top=((1-p.y)/2*this.host.clientHeight)+'px';label.element.style.display=p.z>1||p.z< -1?'none':''}
  }

  private track(object: THREE.Object3D) {
    object.traverse((node) => {
      const renderable = node as THREE.Mesh
      if (renderable.geometry) this.geometries.add(renderable.geometry)
      if (renderable.material) {
        const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material]
        materials.forEach((material) => this.materials.add(material))
      }
    })
  }

  private releaseResources() {
    this.geometries.forEach((geometry) => geometry.dispose())
    this.materials.forEach((material) => material.dispose())
    this.geometries.clear()
    this.materials.clear()
  }

  private template(part: string, color: string, raw = false): Promise<THREE.Group> {
    const key = `${part}:${color}:${raw}`
    const cached = this.templates.get(key)
    if (cached) return cached
    const pending = (async () => {
      const capability = geometrySupport(part)
      if (!raw && (!capability.supported || !capability.geometry)) throw new Error(capability.reasons.join('; '))
      const transform = raw ? {rotationX:Math.PI,offsetLdu:{x:0,y:0,z:0}} : capability.geometry!.ldraw
      const manager = new THREE.LoadingManager()
      const failedUrls = new Set<string>()
      manager.onError = (url) => { failedUrls.add(url) }
      const loader = new LDrawLoader(manager)
      loader.setConditionalLineMaterial(LDrawConditionalLineMaterial)
      loader.setPartsLibraryPath(this.libraryUrl)
      try {
        await loader.preloadMaterials(`${this.libraryUrl}LDConfig.ldr`)
        if (!loader.getMaterial(color)) throw new Error(`LDConfig.ldr 中没有颜色代码 ${color}`)
        // A type-1 reference assigns the standard parent colour. All geometry
        // and fixed subpart colours still come from the original .dat files.
        loader.addDefaultMaterials()
        const model = await new Promise<THREE.Group>((resolve, reject) => {
          loader.parse(`0 DUPLO preview\n1 ${color} 0 0 0 1 0 0 0 1 0 0 0 1 ${part}.dat\n`, resolve, reject)
        })
        this.track(model)
        if (failedUrls.size) throw new Error(`零件或子文件读取失败：${[...failedUrls].join(', ')}`)
        let meshes = 0
        model.traverse((node) => { if ((node as THREE.Mesh).isMesh) meshes++ })
        if (!meshes) throw new Error('LDrawLoader 没有返回可显示的网格')
        // LDraw +Y points down. Rotate (not reflect) to preserve winding.
        // 1 scene unit = 1 mm. Profile aligns the original entry to its body bottom.
        // LDrawLoader retains all alias/subfile transforms; do not strip redirects.
        model.rotation.x = transform.rotationX
        model.scale.setScalar(MM_PER_LDU)
        model.position.set(transform.offsetLdu.x * MM_PER_LDU, transform.offsetLdu.y * MM_PER_LDU, transform.offsetLdu.z * MM_PER_LDU)
        const positioned = new THREE.Group()
        positioned.add(model)
        return positioned
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error)
        throw new Error(`${part}.dat / 颜色 ${color} 加载失败：${details}${failedUrls.size ? `\n请求：${[...failedUrls].join(', ')}` : ''}`)
      } finally {
        // Include unused preloaded materials in lifetime cleanup as well.
        loader.materials.forEach((material) => this.materials.add(material))
        if (this.disposed) this.releaseResources()
      }
    })()
    this.templates.set(key, pending)
    pending.catch(() => { if (this.templates.get(key) === pending) this.templates.delete(key) })
    return pending
  }

  // Transactional update: a failed load leaves the previous complete assembly.
  async replace(bricks: Brick[]): Promise<boolean> {
    this.clearBuildMotion()
    const revision = ++this.revision
    const models = await Promise.all(bricks.map((brick) => this.template(brick.part, brick.color)))
    if (this.disposed || revision !== this.revision) return false
    const objects = bricks.map((brick, index) => {
      const object = models[index].clone(true)
      object.position.set(brick.x * STUD_LDU * MM_PER_LDU, brick.layer * BODY_LDU * MM_PER_LDU, brick.z * STUD_LDU * MM_PER_LDU)
      object.rotation.y = THREE.MathUtils.degToRad(brick.rotation)
      object.name = brick.id
      return object
    })
    this.restoreHighlight()
    this.assembly.clear()
    this.assembly.add(...objects)
    this.fit()
    if(this.highlightIds.length)this.highlight(this.highlightIds)
    return true
  }

  // Explicit read-only DAT inspection. Normal assembly replace() still requires a Profile.
  async inspectPart(part:string,color='14'){
    if(!/^[a-z0-9_-]+$/i.test(part))throw new Error('Invalid LDraw Part ID')
    const revision=++this.revision,capability=geometrySupport(part)
    const model=await this.template(part,color,!capability.supported)
    if(this.disposed||revision!==this.revision)return false
    this.restoreHighlight();this.highlightIds=[];this.clearCandidates();this.clearPreview();this.clearProfileMarkers()
    this.assembly.clear();const object=model.clone(true);object.name=part;this.assembly.add(object);this.fit();return true
  }

  clearProfileMarkers(){
    this.profileBindings=[];this.profileLayer.clear();this.profileOverlay?.remove();this.profileOverlay=null;this.profileLabels=[]
    this.profileResources.forEach(r=>r.dispose());this.profileResources=[]
  }

  showProfileMarkers(g:PartGeometry|undefined,showTop:boolean,showBottom:boolean,selected:string|null,onPick:(face:'top'|'bottom',index:number,p:Connector)=>void){
    this.buildProfileMarkers([{id:'',g}],showTop,showBottom,selected,'',(_id,face,index,p)=>onPick(face,index,p))
  }

  showInstanceConnectors(showTop:boolean,showBottom:boolean,selected:string|null,axisId:string|null,onPick:(id:string,face:'top'|'bottom',index:number,p:Connector)=>void){
    this.buildProfileMarkers(this.assembly.children.map(owner=>({id:owner.name,owner,g:geometrySupport(owner.userData.part).supported?geometrySupport(owner.userData.part).geometry??undefined:undefined})),showTop,showBottom,selected,axisId??this.assembly.children[0]?.name,onPick)
  }

  private buildProfileMarkers(entries:{id:string;owner?:THREE.Object3D;g?:PartGeometry}[],showTop:boolean,showBottom:boolean,selected:string|null,axisId:string,onPick:(id:string,face:'top'|'bottom',index:number,p:Connector)=>void){
    this.clearProfileMarkers()
    const overlay=document.createElement('div');overlay.style.cssText='position:absolute;inset:0;pointer-events:none;overflow:hidden';this.host.append(overlay);this.profileOverlay=overlay
    for(const entry of entries){
    const {owner,g}=entry,layer=new THREE.Group();this.profileLayer.add(layer)
    if(owner){layer.position.copy(owner.position);layer.quaternion.copy(owner.quaternion);this.profileBindings.push({layer,owner})}
    const label=(text:string,point:THREE.Vector3,colour:string,click?:()=>void)=>{
      const element=document.createElement(click?'button':'span');element.textContent=text;element.style.cssText=`position:absolute;transform:translate(-50%,-50%);font:12px monospace;color:${colour};background:#fffffff0;border:1px solid ${colour};border-radius:3px;padding:3px;white-space:nowrap;pointer-events:${click?'auto':'none'}`
      if(text.endsWith('Y')&&!click)element.style.marginLeft=text.startsWith('+')?'22px':'-22px'
      if(click){element.setAttribute('aria-label',entry.id&&entries.length===1?text.split(' · ').at(-1)!:text);if(entry.id)element.textContent=entries.length===1?text.split(' · ').at(-1)!:text.replace(entry.id+' · ','#'+(entries.indexOf(entry)+1)+' ');element.addEventListener('click',click)}overlay.append(element);this.profileLabels.push({element,point,owner})
    }
    if(entry.id===axisId||!entry.id)for(const [axis,colour] of [['x',0xd53636],['y',0x16853a],['z',0x305fdb]] as const)for(const sign of [-1,1]){
      const extent=g?Math.max(24,g.bodySizeLdu[axis]*.8)*MM_PER_LDU:45
      const dir=new THREE.Vector3();dir[axis]=sign*(!g&&axis!=='x'?-1:1)
      const arrow=new THREE.ArrowHelper(dir,new THREE.Vector3(),extent,colour,4,2);layer.add(arrow)
      // ArrowHelper geometries are shared by Three; only release per-arrow materials.
      for(const object of [arrow.line,arrow.cone]){const mats=Array.isArray(object.material)?object.material:[object.material];this.profileResources.push(...mats)}
      label((sign>0?'+':'−')+axis.toUpperCase(),dir.clone().multiplyScalar(extent),new THREE.Color(colour).getStyle())
    }
    if(!g)continue
    for(const face of ['top','bottom'] as const){if(face==='top'?!showTop:!showBottom)continue
      g[face].forEach((p,index)=>{
        const key=`${face}[${index}]`,selectionKey=entry.id?entry.id+':'+key:key,point=new THREE.Vector3(p.x,p.y,p.z).multiplyScalar(MM_PER_LDU)
        const material=new THREE.MeshBasicMaterial({color:selected===selectionKey?0xffbd00:face==='top'?0x0085bc:0xb52b7c,depthTest:false,depthWrite:false});this.profileResources.push(material)
        const marker=new THREE.Mesh(this.markerGeometry,material);marker.position.copy(point);marker.scale.setScalar(selected===selectionKey?1.1:.65);marker.renderOrder=20;layer.add(marker)
        label((entry.id?entry.id+' · ':'')+key,point,selected===selectionKey?'#955d00':face==='top'?'#00658e':'#9f185f',()=>onPick(entry.id,face,index,p))
      })
    }
    }
  }

  enableProfileEditing(changed:(state:DebugScene)=>void){
    this.profileEditing?.dispose();this.profileEditing=new ProfileInteraction(this.renderer.domElement,this.camera,this.controls,this.assembly,this.scene,changed)
  }
  selectProfileInstance(id:string|null){this.profileEditing?.select(id)}
  setProfileMode(mode:DebugScene['mode']){this.profileEditing?.setMode(mode);this.renderer.domElement.focus({preventScroll:true})}
  setProfilePose(id:string,pose:DebugPose){this.profileEditing?.pose(id,pose)}
  getProfileWorldPoint(id:string,p:{x:number;y:number;z:number}){
    const object=this.assembly.children.find(o=>o.name===id);if(!object)return null
    object.updateMatrixWorld(true);const q=object.localToWorld(new THREE.Vector3(p.x,p.y,p.z).multiplyScalar(MM_PER_LDU)).divideScalar(MM_PER_LDU)
    return {x:q.x,y:q.y,z:q.z}
  }
  async inspectInstances(entries:{id:string;part:string}[]):Promise<DebugInstance[]|null>{
    if(!entries.length||new Set(entries.map(e=>e.id)).size!==entries.length||entries.some(e=>!/^[a-z0-9_-]+$/i.test(e.part)))throw new Error('Invalid debug instances')
    const revision=++this.revision
    const models=await Promise.all(entries.map(e=>this.template(e.part,'14',!geometrySupport(e.part).supported)))
    if(this.disposed||revision!==this.revision)return null
    this.profileEditing?.select(null);this.restoreHighlight();this.highlightIds=[];this.clearCandidates();this.clearPreview();this.clearProfileMarkers();this.assembly.clear()
    let right=0
    const objects=models.map((model,i)=>{const object=model.clone(true),bounds=new THREE.Box3().setFromObject(object);object.name=entries[i].id;object.userData.part=entries[i].part
      object.position.x=right-bounds.min.x;right+=bounds.max.x-bounds.min.x+24
      return object})
    if(objects.length===1)objects[0].position.x=0
    else {const center=new THREE.Box3();objects.forEach(o=>center.union(new THREE.Box3().setFromObject(o)));const x=center.getCenter(new THREE.Vector3()).x;objects.forEach(o=>{o.position.x-=x})}
    this.assembly.add(...objects);this.fit();this.profileEditing?.select(objects[0].name)
    return objects.map(o=>({id:o.name,part:o.userData.part,x:o.position.x/MM_PER_LDU,y:0,z:0,rotation:0}))
  }

  private restoreHighlight() {
    this.originalMaterials.forEach((material,object)=>{object.material=material})
    this.originalMaterials.clear()
    this.debugMaterials.forEach(material=>material.dispose());this.debugMaterials.clear()
    delete this.host.dataset.highlightIds
  }

  highlight(ids: string[], highlightStyle: 'debug' | 'build' = 'debug') {
    const wasHighlighted=this.highlightIds.length>0
    this.highlightIds=[...ids]
    this.restoreHighlight()
    const selected=this.assembly.children.filter(object=>ids.includes(object.name))
    if(!ids.length){if(wasHighlighted)this.fit({x:-0.85,y:0.8,z:2.2});return}
    if(selected.length!==ids.length)return // Never substitute another part by index or colour.
    const box=new THREE.Box3()
    for(const object of this.assembly.children){
      const index=ids.indexOf(object.name),clones=new Map<THREE.Material,THREE.Material>()
      if(index>=0)box.union(new THREE.Box3().setFromObject(object))
      object.traverse(child=>{
        const renderable=child as THREE.Mesh | THREE.LineSegments
        if(!renderable.material)return
        this.originalMaterials.set(renderable,renderable.material)
        const style=(material:THREE.Material)=>{
          let clone=clones.get(material)
          if(!clone){
            clone=material.clone();clones.set(material,clone);this.debugMaterials.add(clone)
            if(index>=0){const coloured=clone as THREE.MeshStandardMaterial;if(coloured.color)coloured.color.set(highlightStyle==='build'?'#39bd67':index===0?'#00aaff':'#ff248f')}
            else if(highlightStyle==='debug'){clone.transparent=true;clone.opacity=0.16;clone.depthWrite=false}
          }
          return clone
        }
        renderable.material=Array.isArray(renderable.material)?renderable.material.map(style):style(renderable.material)
      })
    }
    this.host.dataset.highlightIds=JSON.stringify(ids)
    this.focusBox(box,this.camera.position.clone().sub(this.controls.target))
  }

  // Temporary display transforms only. Final Brick[] remains immutable.
  clearBuildMotion() {
    const motion=this.buildMotion
    if(motion)for(const m of motion.members){m.object.position.copy(m.position);m.object.quaternion.copy(m.quaternion)}
    this.buildMotion=null
    if(this.buildArrow){
      this.scene.remove(this.buildArrow)
      this.buildArrow.line.geometry.dispose();this.buildArrow.cone.geometry.dispose()
      for(const object of [this.buildArrow.line,this.buildArrow.cone]){
        const materials=Array.isArray(object.material)?object.material:[object.material]
        materials.forEach(m=>m.dispose())
      }
      this.buildArrow=null
    }
  }

  async prepareBuildStep(target:Brick[],moving:Brick[],motion:{offsetLdu:{x:number;y:number;z:number};startYawDegrees:number},done:()=>void):Promise<boolean>{
    if(!moving.length||new Set([...target,...moving].map(b=>b.id)).size!==target.length+moving.length)throw Error('步骤组件为空或重复使用实例')
    if(![motion.offsetLdu.x,motion.offsetLdu.y,motion.offsetLdu.z,motion.startYawDegrees].every(Number.isFinite))throw Error('动画提示无效')
    this.clearPreview();this.highlightIds=[]
    if(!await this.replace([...target,...moving]))return false
    const revision=this.revision
    await this.showPreview(moving)
    if(this.disposed||revision!==this.revision)return false
    const ids=new Set(moving.map(b=>b.id)),objects=this.assembly.children.filter(o=>ids.has(o.name))
    const box=new THREE.Box3();objects.forEach(o=>box.union(new THREE.Box3().setFromObject(o)))
    const pivot=box.getCenter(new THREE.Vector3()),offset=new THREE.Vector3(motion.offsetLdu.x,motion.offsetLdu.y,motion.offsetLdu.z).multiplyScalar(MM_PER_LDU)
    this.buildMotion={members:objects.map(object=>({object,position:object.position.clone(),quaternion:object.quaternion.clone()})),pivot,offset,
      startRotation:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),THREE.MathUtils.degToRad(motion.startYawDegrees)),started:null,duration:1200,done}
    this.applyBuildMotion(0)
    if(offset.length()>0.001){
      this.buildArrow=new THREE.ArrowHelper(offset.clone().negate().normalize(),pivot.clone().add(offset),offset.length(),0x208b46,Math.min(8,offset.length()/3),Math.min(4,offset.length()/6))
      // ArrowHelper shares primitive geometries; own clones for safe disposal.
      this.buildArrow.line.geometry=this.buildArrow.line.geometry.clone();this.buildArrow.cone.geometry=this.buildArrow.cone.geometry.clone()
      this.scene.add(this.buildArrow)
    }
    this.highlight(moving.map(b=>b.id),'build');this.fit()
    return true
  }

  playBuildStep(){
    if(!this.buildMotion)return
    this.buildMotion.started=performance.now()
  }

  private applyBuildMotion(progress:number){
    const m=this.buildMotion;if(!m)return
    const q=new THREE.Quaternion().slerpQuaternions(m.startRotation,new THREE.Quaternion(),progress)
    for(const member of m.members){
      if(progress===1){member.object.position.copy(member.position);member.object.quaternion.copy(member.quaternion);continue}
      member.object.position.copy(member.position).sub(m.pivot).applyQuaternion(q).add(m.pivot).addScaledVector(m.offset,1-progress)
      member.object.quaternion.copy(q).multiply(member.quaternion)
    }
  }

  private updateBuildMotion(){
    const m=this.buildMotion;if(!m||m.started===null)return
    const t=Math.min(1,(performance.now()-m.started)/m.duration)
    this.applyBuildMotion(t*t*(3-2*t))
    if(t===1){m.started=null;this.clearPreview();if(this.buildArrow)this.buildArrow.visible=false;this.restoreHighlight();this.highlightIds=[];m.done()}
  }

  reset() {
    this.clearBuildMotion()
    ++this.revision
    this.clearCandidates()
    this.clearPreview()
    this.restoreHighlight()
    this.assembly.clear()
    this.home()
  }

  private home() {
    this.camera.position.set(180, 150, 220)
    this.controls.target.set(0, 25, 0)
    this.controls.update()
  }

  fit(direction = { x: 1, y: 0.85, z: 1.2 }) {
    const viewDirection = new THREE.Vector3(direction.x, direction.y, direction.z)
    if (![direction.x, direction.y, direction.z].every(Number.isFinite) || viewDirection.lengthSq() < 1e-12) throw new Error('Invalid view direction')
    if (!this.assembly.children.length && !this.preview.children.length) return this.home()
    const box = new THREE.Box3().setFromObject(this.assembly)
    if (this.preview.children.length) box.union(new THREE.Box3().setFromObject(this.preview))
    this.focusBox(box,viewDirection)
  }

  private focusBox(box:THREE.Box3,viewDirection:THREE.Vector3){
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    const vertical = THREE.MathUtils.degToRad(this.camera.fov) / 2
    const horizontal = Math.atan(Math.tan(vertical) * this.camera.aspect)
    const distance = Math.max(40, sphere.radius / Math.sin(Math.min(vertical, horizontal)) * 1.2)
    this.controls.target.copy(sphere.center)
    this.camera.position.copy(sphere.center).addScaledVector(viewDirection.normalize(), distance)
    this.controls.update()
  }

  dispose() {
    this.clearBuildMotion()
    this.profileEditing?.dispose();this.profileEditing=null
    this.restoreHighlight()
    this.clearProfileMarkers()
    this.disposed = true
    ++this.revision
    cancelAnimationFrame(this.frame)
    this.observer.disconnect()
    this.controls.dispose()
    this.clearPreview()
    this.clearCandidates()
    this.markerGeometry.dispose()
    this.markerMaterial.dispose()
    this.selectedMarkerMaterial.dispose()
    this.renderer.domElement.removeEventListener('pointerdown', this.pointerDown)
    this.renderer.domElement.removeEventListener('pointermove', this.pointerMove)
    this.renderer.domElement.removeEventListener('pointerup', this.pointerUp)
    this.renderer.domElement.removeEventListener('pointercancel', this.pointerCancel)
    this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost)
    this.scene.clear()
    this.templates.clear()
    this.releaseResources()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
