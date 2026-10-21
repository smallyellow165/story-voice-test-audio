import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { LDrawLoader } from 'three/addons/loaders/LDrawLoader.js'
import { LDrawConditionalLineMaterial } from 'three/addons/materials/LDrawConditionalLineMaterial.js'
import { BODY_LDU, MM_PER_LDU, STUD_LDU } from './catalog'
import type { Brick } from './catalog'
import type { Candidate } from './assembly'

// No React, routing, or app-service dependency: mount in any sized DOM element.
export class BrickViewer {
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000)
  private renderer: THREE.WebGLRenderer
  private controls: OrbitControls
  private assembly = new THREE.Group()
  private observer: ResizeObserver
  private templates = new Map<string, Promise<THREE.Group>>()
  private geometries = new Set<THREE.BufferGeometry>()
  private materials = new Set<THREE.Material>()
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
    this.scene.add(fill, this.assembly, this.markers, this.preview)
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
    this.renderer.render(this.scene, this.camera)
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

  private template(part: string, color: string): Promise<THREE.Group> {
    const key = `${part}:${color}`
    const cached = this.templates.get(key)
    if (cached) return cached
    const pending = (async () => {
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
        // 1 scene unit = 1 mm. Body bottom y=48 LDU becomes ground y=0.
        model.rotation.x = Math.PI
        model.scale.setScalar(MM_PER_LDU)
        model.position.y = BODY_LDU * MM_PER_LDU
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
    this.assembly.clear()
    this.assembly.add(...objects)
    this.fit()
    return true
  }

  reset() {
    ++this.revision
    this.clearCandidates()
    this.clearPreview()
    this.assembly.clear()
    this.home()
  }

  private home() {
    this.camera.position.set(180, 150, 220)
    this.controls.target.set(0, 25, 0)
    this.controls.update()
  }

  fit() {
    if (!this.assembly.children.length && !this.preview.children.length) return this.home()
    const box = new THREE.Box3().setFromObject(this.assembly)
    if (this.preview.children.length) box.union(new THREE.Box3().setFromObject(this.preview))
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    const vertical = THREE.MathUtils.degToRad(this.camera.fov) / 2
    const horizontal = Math.atan(Math.tan(vertical) * this.camera.aspect)
    const distance = Math.max(40, sphere.radius / Math.sin(Math.min(vertical, horizontal)) * 1.2)
    this.controls.target.copy(sphere.center)
    this.camera.position.copy(sphere.center).addScaledVector(new THREE.Vector3(1, 0.85, 1.2).normalize(), distance)
    this.controls.update()
  }

  dispose() {
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
