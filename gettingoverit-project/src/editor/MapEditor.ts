import {
  clearEditableMap,
  cloneBaseMap,
  loadEditableMap,
  saveEditableMap,
} from '../data/mapStore';
import type {
  ClimbMap,
  MapObject,
  ObjectType,
  ShapeKind,
  Vec2,
  Zone,
} from '../data/mapData';

const SHAPES: ShapeKind[] = [
  'rect',
  'roundedRect',
  'semicircle',
  'circle',
  'cylinder',
  'ring',
  'staircase',
  'curvedHook',
  'ladder',
  'uHook',
  'triangleRoof',
  'concaveDish',
  'irregularPolygon',
  'stackedRings',
  'trussTower',
  'flag',
  'arch',
];

const TYPES: ObjectType[] = ['solid', 'thin', 'round', 'slippery', 'decorative'];

interface ViewState {
  centerX: number;
  centerY: number;
  zoom: number;
}

interface DragObjectState {
  pointerId: number;
  objectId: string;
  startWorld: Vec2;
  startPosition: Vec2;
}

interface PanState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startCenter: Vec2;
}

interface ObjectRecord {
  zone: Zone;
  object: MapObject;
  index: number;
}

interface Bounds {
  width: number;
  height: number;
}

interface AddDraft {
  zoneId: string;
  type: ObjectType;
  shape: ShapeKind;
  id: string;
}

export class MapEditor {
  private readonly container: HTMLElement;
  private readonly root = document.createElement('div');
  private readonly sidebar = document.createElement('aside');
  private readonly toolbar = document.createElement('div');
  private readonly addPanel = document.createElement('section');
  private readonly spawnPanel = document.createElement('section');
  private readonly selectedPanel = document.createElement('section');
  private readonly listPanel = document.createElement('section');
  private readonly viewport = document.createElement('div');
  private readonly svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

  private map: ClimbMap = loadEditableMap();
  private selectedId: string | null = this.map.zones[0]?.objects[0]?.id ?? null;
  private addDraft: AddDraft = {
    zoneId: this.map.zones[0]?.id ?? '',
    type: 'solid',
    shape: 'rect',
    id: '',
  };

  private readonly view: ViewState = {
    centerX: 0,
    centerY: 90,
    zoom: 8,
  };

  private pointerWorld: Vec2 = { x: 0, y: 0 };
  private dragObject: DragObjectState | null = null;
  private panState: PanState | null = null;
  private placingSpawn = false;
  private statusText = 'Left-drag objects to move them. Right-drag to pan. Mouse wheel zooms.';
  private statusTimer: number | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.innerHTML = '';
    this.addDraft.id = this.makeSuggestedId(this.addDraft.shape);

    this.root.className = 'editor-shell';
    this.sidebar.className = 'editor-sidebar';
    this.toolbar.className = 'editor-toolbar';
    this.addPanel.className = 'editor-panel';
    this.spawnPanel.className = 'editor-panel';
    this.selectedPanel.className = 'editor-panel';
    this.listPanel.className = 'editor-panel editor-panel-grow';
    this.viewport.className = 'editor-viewport';
    this.svg.classList.add('editor-canvas');

    this.viewport.appendChild(this.svg);
    this.sidebar.append(this.addPanel, this.spawnPanel, this.selectedPanel, this.listPanel);
    this.root.append(this.sidebar, this.viewport, this.toolbar);
    this.container.appendChild(this.root);

    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('input', this.onInput);
    this.root.addEventListener('change', this.onInput);
    this.viewport.addEventListener('wheel', this.onWheel, { passive: false });
    this.viewport.addEventListener('pointerdown', this.onPointerDown);
    this.viewport.addEventListener('pointermove', this.onPointerMove);
    this.viewport.addEventListener('pointerup', this.onPointerUp);
    this.viewport.addEventListener('pointercancel', this.onPointerUp);
    this.viewport.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('resize', this.onResize);

    requestAnimationFrame(() => {
      this.fitView();
      this.render();
    });
  }

  dispose(): void {
    this.root.removeEventListener('click', this.onClick);
    this.root.removeEventListener('input', this.onInput);
    this.root.removeEventListener('change', this.onInput);
    this.viewport.removeEventListener('wheel', this.onWheel);
    this.viewport.removeEventListener('pointerdown', this.onPointerDown);
    this.viewport.removeEventListener('pointermove', this.onPointerMove);
    this.viewport.removeEventListener('pointerup', this.onPointerUp);
    this.viewport.removeEventListener('pointercancel', this.onPointerUp);
    this.viewport.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('resize', this.onResize);
  }

  private onResize = (): void => {
    this.renderViewport();
  };

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private onClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement;
    const actionEl = target.closest<HTMLElement>('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;
    if (!action) return;

    switch (action) {
      case 'zoom-in':
        this.adjustZoom(1.15);
        return;
      case 'zoom-out':
        this.adjustZoom(1 / 1.15);
        return;
      case 'fit-view':
        this.fitView();
        this.renderViewport();
        return;
      case 'copy-json':
        void this.copyMapJson();
        return;
      case 'reset-map':
        this.resetMap();
        return;
      case 'place-spawn':
        this.placingSpawn = !this.placingSpawn;
        this.setStatus(this.placingSpawn ? 'Click in the viewport to place the spawn point.' : defaultStatusText());
        this.render();
        return;
      case 'set-spawn-pointer':
        this.setSpawnPoint(this.pointerWorld);
        return;
      case 'add-object':
        this.addObject();
        return;
      case 'duplicate-object':
        this.duplicateSelected();
        return;
      case 'delete-object':
        this.deleteSelected();
        return;
      case 'select-object': {
        const objectId = actionEl.dataset.objectId;
        if (!objectId) return;
        this.selectedId = objectId;
        this.render();
        return;
      }
      default:
        return;
    }
  };

  private onInput = (event: Event): void => {
    const target = event.target as HTMLInputElement | HTMLSelectElement | null;
    if (!target) return;

    if (target.dataset.addField) {
      const field = target.dataset.addField as keyof AddDraft;
      this.addDraft[field] = target.value as never;
      if (field === 'shape' && (!this.addDraft.id || this.addDraft.id.startsWith('new_'))) {
        this.addDraft.id = this.makeSuggestedId(this.addDraft.shape);
      }
      this.renderAddPanel();
      return;
    }

    if (target.dataset.spawnAxis) {
      const axis = target.dataset.spawnAxis as 'x' | 'y';
      this.map.playerStart[axis] = this.readNumber(target.value, this.map.playerStart[axis]);
      this.persistAndRender();
      return;
    }

    const selected = this.getSelectedRecord();
    if (!selected) return;
    const obj = selected.object;

    if (target.dataset.selectedIdField === 'id') {
      obj.id = target.value.trim() || obj.id;
      this.selectedId = obj.id;
      this.persistAndRender();
      return;
    }

    if (target.dataset.selectedZone === 'zone') {
      this.moveSelectedToZone(target.value);
      return;
    }

    if (target.dataset.selectedType === 'type') {
      obj.type = target.value as ObjectType;
      this.persistAndRender();
      return;
    }

    if (target.dataset.selectedShape === 'shape') {
      this.replaceSelectedShape(target.value as ShapeKind);
      return;
    }

    if (target.dataset.selectedField) {
      const field = target.dataset.selectedField as 'material' | 'difficulty' | 'notes' | 'rotation';
      if (field === 'rotation') {
        obj.rotation = this.readNumber(target.value, obj.rotation ?? 0);
      } else {
        obj[field] = target.value;
      }
      this.persistAndRender();
      return;
    }

    if (target.dataset.selectedPosition) {
      const axis = target.dataset.selectedPosition as 'x' | 'y';
      obj.position[axis] = this.readNumber(target.value, obj.position[axis]);
      this.persistAndRender();
      return;
    }

    if (target.dataset.selectedSize) {
      const key = target.dataset.selectedSize as keyof NonNullable<MapObject['size']>;
      obj.size ??= {};
      obj.size[key] = this.readNumber(target.value, obj.size[key] ?? 1);
      this.persistAndRender();
      return;
    }

    if (target.dataset.selectedExtra) {
      const key = target.dataset.selectedExtra as 'steps' | 'count';
      obj[key] = Math.max(1, Math.round(this.readNumber(target.value, obj[key] ?? 1)));
      this.persistAndRender();
      return;
    }

    if (target.dataset.selectedStepSize) {
      const key = target.dataset.selectedStepSize as 'width' | 'height';
      obj.stepSize ??= { width: 1.2, height: 0.7 };
      obj.stepSize[key] = this.readNumber(target.value, obj.stepSize[key]);
      this.persistAndRender();
    }
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();

    const before = this.clientToWorld(event.clientX, event.clientY);
    const factor = Math.exp(-event.deltaY * 0.0012);
    this.view.zoom = clamp(this.view.zoom * factor, 2, 80);
    const after = this.clientToWorld(event.clientX, event.clientY);

    this.view.centerX += before.x - after.x;
    this.view.centerY += before.y - after.y;
    this.renderViewport();
  };

  private onPointerDown = (event: PointerEvent): void => {
    this.pointerWorld = this.clientToWorld(event.clientX, event.clientY);

    if (this.placingSpawn && event.button === 0) {
      this.setSpawnPoint(this.pointerWorld);
      return;
    }

    const objectEl = (event.target as Element).closest<SVGGElement>('[data-object-id]');
    if (objectEl && event.button === 0) {
      const objectId = objectEl.dataset.objectId;
      const selected = objectId ? this.findObject(objectId) : null;
      if (!objectId || !selected) return;

      this.selectedId = objectId;
      this.dragObject = {
        pointerId: event.pointerId,
        objectId,
        startWorld: { ...this.pointerWorld },
        startPosition: { ...selected.object.position },
      };
      this.viewport.setPointerCapture(event.pointerId);
      this.render();
      return;
    }

    if (event.button === 1 || event.button === 2) {
      this.panState = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startCenter: { x: this.view.centerX, y: this.view.centerY },
      };
      this.viewport.setPointerCapture(event.pointerId);
      return;
    }

    if (!objectEl && event.button === 0) {
      this.selectedId = null;
      this.render();
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    this.pointerWorld = this.clientToWorld(event.clientX, event.clientY);

    if (this.dragObject && this.dragObject.pointerId === event.pointerId) {
      const record = this.findObject(this.dragObject.objectId);
      if (!record) return;

      const dx = this.pointerWorld.x - this.dragObject.startWorld.x;
      const dy = this.pointerWorld.y - this.dragObject.startWorld.y;
      record.object.position.x = round2(this.dragObject.startPosition.x + dx);
      record.object.position.y = round2(this.dragObject.startPosition.y + dy);
      this.renderViewport();
      this.renderSelectedPanel();
      this.renderToolbar();
      return;
    }

    if (this.panState && this.panState.pointerId === event.pointerId) {
      const dx = event.clientX - this.panState.startClientX;
      const dy = event.clientY - this.panState.startClientY;
      this.view.centerX = this.panState.startCenter.x - dx / this.view.zoom;
      this.view.centerY = this.panState.startCenter.y + dy / this.view.zoom;
      this.renderViewport();
      return;
    }

    this.renderToolbar();
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (this.dragObject && this.dragObject.pointerId === event.pointerId) {
      this.dragObject = null;
      saveEditableMap(this.map);
      this.render();
    }

    if (this.panState && this.panState.pointerId === event.pointerId) {
      this.panState = null;
    }
  };

  private render(): void {
    this.renderAddPanel();
    this.renderSpawnPanel();
    this.renderSelectedPanel();
    this.renderObjectList();
    this.renderToolbar();
    this.renderViewport();
  }

  private renderToolbar(): void {
    const selected = this.getSelectedRecord();
    this.toolbar.innerHTML = `
      <div class="editor-toolbar-left">
        <strong>Map Editor</strong>
        <span class="editor-toolbar-text">${escapeHtml(this.statusText)}</span>
      </div>
      <div class="editor-toolbar-center">
        <span>Pointer: ${this.pointerWorld.x.toFixed(2)}, ${this.pointerWorld.y.toFixed(2)}</span>
        <span>${selected ? `Selected: ${escapeHtml(selected.object.id)}` : 'No selection'}</span>
      </div>
      <div class="editor-toolbar-right">
        <button type="button" data-action="zoom-out">-</button>
        <button type="button" data-action="zoom-in">+</button>
        <button type="button" data-action="fit-view">Fit</button>
        <button type="button" data-action="duplicate-object" ${selected ? '' : 'disabled'}>Duplicate</button>
        <button type="button" data-action="copy-json">Copy JSON</button>
        <button type="button" data-action="reset-map">Reset</button>
        <a href="./" class="editor-play-link">Play</a>
      </div>
    `;
  }

  private renderAddPanel(): void {
    this.addPanel.innerHTML = `
      <h2>Add Object</h2>
      <label class="editor-field">
        <span>Zone</span>
        <select data-add-field="zoneId">
          ${this.map.zones.map((zone) => `
            <option value="${escapeHtml(zone.id)}" ${zone.id === this.addDraft.zoneId ? 'selected' : ''}>
              ${escapeHtml(zone.name)}
            </option>
          `).join('')}
        </select>
      </label>
      <label class="editor-field">
        <span>ID</span>
        <input data-add-field="id" type="text" value="${escapeHtml(this.addDraft.id)}" />
      </label>
      <label class="editor-field">
        <span>Type</span>
        <select data-add-field="type">
          ${TYPES.map((type) => `
            <option value="${type}" ${type === this.addDraft.type ? 'selected' : ''}>${type}</option>
          `).join('')}
        </select>
      </label>
      <label class="editor-field">
        <span>Shape</span>
        <select data-add-field="shape">
          ${SHAPES.map((shape) => `
            <option value="${shape}" ${shape === this.addDraft.shape ? 'selected' : ''}>${shape}</option>
          `).join('')}
        </select>
      </label>
      <button type="button" class="editor-primary" data-action="add-object">Add Object</button>
    `;
  }

  private renderSpawnPanel(): void {
    this.spawnPanel.innerHTML = `
      <h2>Spawn Point</h2>
      <div class="editor-row">
        <label class="editor-field">
          <span>X</span>
          <input data-spawn-axis="x" type="number" step="0.1" value="${this.map.playerStart.x}" />
        </label>
        <label class="editor-field">
          <span>Y</span>
          <input data-spawn-axis="y" type="number" step="0.1" value="${this.map.playerStart.y}" />
        </label>
      </div>
      <div class="editor-panel-actions">
        <button type="button" class="editor-primary" data-action="place-spawn">
          ${this.placingSpawn ? 'Cancel Spawn Placement' : 'Place Spawn In View'}
        </button>
        <button type="button" class="editor-secondary" data-action="set-spawn-pointer">Set Spawn To Pointer</button>
      </div>
    `;
  }

  private renderSelectedPanel(): void {
    const record = this.getSelectedRecord();
    if (!record) {
      this.selectedPanel.innerHTML = `
        <h2>Selected Object</h2>
        <p class="editor-empty">Click an object in the viewport or list to edit it.</p>
      `;
      return;
    }

    const { zone, object } = record;
    this.selectedPanel.innerHTML = `
      <h2>Selected Object</h2>
      <label class="editor-field">
        <span>ID</span>
        <input data-selected-id-field="id" type="text" value="${escapeHtml(object.id)}" />
      </label>
      <div class="editor-row">
        <label class="editor-field">
          <span>Zone</span>
          <select data-selected-zone="zone">
            ${this.map.zones.map((entry) => `
              <option value="${escapeHtml(entry.id)}" ${entry.id === zone.id ? 'selected' : ''}>
                ${escapeHtml(entry.name)}
              </option>
            `).join('')}
          </select>
        </label>
        <label class="editor-field">
          <span>Type</span>
          <select data-selected-type="type">
            ${TYPES.map((type) => `
              <option value="${type}" ${type === object.type ? 'selected' : ''}>${type}</option>
            `).join('')}
          </select>
        </label>
      </div>
      <div class="editor-row">
        <label class="editor-field">
          <span>Shape</span>
          <select data-selected-shape="shape">
            ${SHAPES.map((shape) => `
              <option value="${shape}" ${shape === object.shape ? 'selected' : ''}>${shape}</option>
            `).join('')}
          </select>
        </label>
        <label class="editor-field">
          <span>Rotation</span>
          <input data-selected-field="rotation" type="number" step="1" value="${object.rotation ?? 0}" />
        </label>
      </div>
      <div class="editor-row">
        <label class="editor-field">
          <span>X</span>
          <input data-selected-position="x" type="number" step="0.1" value="${object.position.x}" />
        </label>
        <label class="editor-field">
          <span>Y</span>
          <input data-selected-position="y" type="number" step="0.1" value="${object.position.y}" />
        </label>
      </div>
      ${this.renderSizeFields(object)}
      ${this.renderExtraFields(object)}
      <label class="editor-field">
        <span>Material</span>
        <input data-selected-field="material" type="text" value="${escapeHtml(object.material ?? '')}" />
      </label>
      <label class="editor-field">
        <span>Difficulty</span>
        <input data-selected-field="difficulty" type="text" value="${escapeHtml(object.difficulty ?? '')}" />
      </label>
      <label class="editor-field">
        <span>Notes</span>
        <input data-selected-field="notes" type="text" value="${escapeHtml(object.notes ?? '')}" />
      </label>
      <button type="button" class="editor-secondary" data-action="duplicate-object">Duplicate Selected</button>
      <button type="button" class="editor-danger" data-action="delete-object">Delete Selected</button>
    `;
  }

  private renderObjectList(): void {
    this.listPanel.innerHTML = `
      <h2>Objects</h2>
      <div class="editor-object-list">
        ${this.map.zones.map((zone) => `
          <section class="editor-zone-list">
            <h3>${escapeHtml(zone.name)} <span>${zone.objects.length}</span></h3>
            <div class="editor-zone-objects">
              ${zone.objects.map((object) => `
                <button
                  type="button"
                  class="editor-object-button ${object.id === this.selectedId ? 'is-selected' : ''}"
                  data-action="select-object"
                  data-object-id="${escapeHtml(object.id)}"
                >
                  <strong>${escapeHtml(object.id)}</strong>
                  <span>${escapeHtml(object.shape)} at ${object.position.x.toFixed(1)}, ${object.position.y.toFixed(1)}</span>
                </button>
              `).join('')}
            </div>
          </section>
        `).join('')}
      </div>
    `;
  }

  private renderViewport(): void {
    const rect = this.viewport.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const world = this.map.worldBounds;
    const transform = [
      `translate(${width / 2} ${height / 2})`,
      `scale(${this.view.zoom} ${-this.view.zoom})`,
      `translate(${-this.view.centerX} ${-this.view.centerY})`,
    ].join(' ');

    this.svg.innerHTML = `
      <rect class="editor-canvas-bg" x="0" y="0" width="${width}" height="${height}" />
      <g transform="${transform}">
        ${this.renderGrid(world)}
        <rect
          x="${world.minX}"
          y="${world.minY}"
          width="${world.maxX - world.minX}"
          height="${world.maxY - world.minY}"
          class="editor-world-bounds"
        />
        ${this.map.zones.map((zone) => `
          <line
            x1="${world.minX}"
            y1="${zone.yRange[0]}"
            x2="${world.maxX}"
            y2="${zone.yRange[0]}"
            class="editor-zone-line"
          />
        `).join('')}
        ${this.map.zones.flatMap((zone) => zone.objects).map((object) => this.renderObjectSvg(object)).join('')}
        ${this.renderSpawnMarker()}
      </g>
    `;
  }

  private renderSpawnMarker(): string {
    const { x, y } = this.map.playerStart;
    return `
      <g class="editor-spawn-marker" transform="translate(${x} ${y})">
        <circle cx="0" cy="0" r="0.55" fill="rgba(124, 230, 255, 0.16)" stroke="#7ce6ff" vector-effect="non-scaling-stroke" />
        <line x1="-0.9" y1="0" x2="0.9" y2="0" stroke="#7ce6ff" vector-effect="non-scaling-stroke" />
        <line x1="0" y1="-0.9" x2="0" y2="0.9" stroke="#7ce6ff" vector-effect="non-scaling-stroke" />
      </g>
    `;
  }

  private renderGrid(world: ClimbMap['worldBounds']): string {
    const majorStep = 10;
    const minorStep = this.view.zoom >= 8 ? 5 : 10;
    const lines: string[] = [];

    for (let x = Math.floor(world.minX / minorStep) * minorStep; x <= world.maxX; x += minorStep) {
      lines.push(`
        <line
          x1="${x}"
          y1="${world.minY}"
          x2="${x}"
          y2="${world.maxY}"
          class="${x % majorStep === 0 ? 'editor-grid-major' : 'editor-grid-minor'}"
        />
      `);
    }

    for (let y = Math.floor(world.minY / minorStep) * minorStep; y <= world.maxY; y += minorStep) {
      lines.push(`
        <line
          x1="${world.minX}"
          y1="${y}"
          x2="${world.maxX}"
          y2="${y}"
          class="${y % majorStep === 0 ? 'editor-grid-major' : 'editor-grid-minor'}"
        />
      `);
    }

    return lines.join('');
  }

  private renderObjectSvg(object: MapObject): string {
    const selected = object.id === this.selectedId;
    const bounds = this.getBounds(object);
    const visuals = this.renderObjectShape(object);

    return `
      <g
        class="editor-object ${selected ? 'is-selected' : ''}"
        data-object-id="${escapeHtml(object.id)}"
        transform="translate(${object.position.x} ${object.position.y}) rotate(${object.rotation ?? 0})"
      >
        <rect
          class="editor-hitbox"
          x="${-bounds.width / 2}"
          y="${-bounds.height / 2}"
          width="${bounds.width}"
          height="${bounds.height}"
        />
        ${visuals}
        ${selected ? `
          <rect
            class="editor-selection-box"
            x="${-bounds.width / 2 - 0.15}"
            y="${-bounds.height / 2 - 0.15}"
            width="${bounds.width + 0.3}"
            height="${bounds.height + 0.3}"
          />
        ` : ''}
      </g>
    `;
  }

  private renderObjectShape(object: MapObject): string {
    const fill = objectFill(object.type);
    const stroke = objectStroke(object.type);
    const width = object.size?.width ?? 1;
    const height = object.size?.height ?? 1;

    switch (object.shape) {
      case 'rect':
        return svgRect(width, height, fill, stroke, 0);
      case 'roundedRect':
        return svgRect(width, height, fill, stroke, Math.min(width, height) * 0.15);
      case 'circle':
        return svgCircle(object.size?.radius ?? 1, fill, stroke);
      case 'cylinder':
        return svgRect(width, height, fill, stroke, height * 0.5);
      case 'ring':
        return svgRing(object.size?.outerRadius ?? 2, object.size?.innerRadius ?? 1.2, fill);
      case 'stackedRings':
        return svgStackedRings(object.count ?? 3, object.size?.outerRadius ?? 1.1, object.size?.innerRadius ?? 0.55, fill);
      case 'triangleRoof':
        return `
          <polygon
            points="${-width / 2},${-height / 2} ${width / 2},${-height / 2} 0,${height / 2}"
            fill="${fill}"
            stroke="${stroke}"
            vector-effect="non-scaling-stroke"
          />
        `;
      case 'semicircle': {
        const r = width / 2;
        return `
          <path
            d="M ${-r} 0 A ${r} ${r} 0 0 1 ${r} 0 L ${r} ${-height / 2} L ${-r} ${-height / 2} Z"
            fill="${fill}"
            stroke="${stroke}"
            vector-effect="non-scaling-stroke"
          />
        `;
      }
      case 'staircase':
        return svgStaircase(object.steps ?? 4, object.stepSize?.width ?? 1.2, object.stepSize?.height ?? 0.7, fill, stroke);
      case 'ladder':
        return svgLadder(width, height, fill, stroke);
      case 'uHook':
        return svgUHook(width, height, fill, stroke);
      case 'curvedHook':
        return svgCurvedHook(width, height, fill, stroke);
      case 'concaveDish':
        return svgDish(width, height, fill, stroke);
      case 'irregularPolygon':
        return svgPolygon(object.points ?? [], fill, stroke);
      case 'trussTower':
        return svgTower(width, height, fill, stroke);
      case 'flag':
        return svgFlag(width, height, fill, stroke);
      case 'arch':
        return svgArch(width, height, fill, stroke);
      default:
        return svgRect(width, height, fill, stroke, 0);
    }
  }

  private renderSizeFields(object: MapObject): string {
    const size = object.size ?? {};
    const fields: string[] = [];

    for (const key of ['width', 'height', 'radius', 'outerRadius', 'innerRadius'] as const) {
      if (size[key] == null) continue;
      fields.push(`
        <label class="editor-field">
          <span>${key}</span>
          <input data-selected-size="${key}" type="number" step="0.1" value="${size[key]}" />
        </label>
      `);
    }

    if (!fields.length) return '';
    return `<div class="editor-grid">${fields.join('')}</div>`;
  }

  private renderExtraFields(object: MapObject): string {
    const fields: string[] = [];

    if (object.steps != null) {
      fields.push(`
        <label class="editor-field">
          <span>Steps</span>
          <input data-selected-extra="steps" type="number" step="1" value="${object.steps}" />
        </label>
      `);
    }

    if (object.stepSize) {
      fields.push(`
        <label class="editor-field">
          <span>Step Width</span>
          <input data-selected-step-size="width" type="number" step="0.1" value="${object.stepSize.width}" />
        </label>
      `);
      fields.push(`
        <label class="editor-field">
          <span>Step Height</span>
          <input data-selected-step-size="height" type="number" step="0.1" value="${object.stepSize.height}" />
        </label>
      `);
    }

    if (object.count != null) {
      fields.push(`
        <label class="editor-field">
          <span>Count</span>
          <input data-selected-extra="count" type="number" step="1" value="${object.count}" />
        </label>
      `);
    }

    if (!fields.length) return '';
    return `<div class="editor-grid">${fields.join('')}</div>`;
  }

  private getSelectedRecord(): ObjectRecord | null {
    return this.selectedId ? this.findObject(this.selectedId) : null;
  }

  private findObject(id: string): ObjectRecord | null {
    for (const zone of this.map.zones) {
      const index = zone.objects.findIndex((object) => object.id === id);
      if (index >= 0) {
        return { zone, object: zone.objects[index], index };
      }
    }
    return null;
  }

  private getZoneById(zoneId: string): Zone | null {
    return this.map.zones.find((zone) => zone.id === zoneId) ?? null;
  }

  private moveSelectedToZone(zoneId: string): void {
    const selected = this.getSelectedRecord();
    const targetZone = this.getZoneById(zoneId);
    if (!selected || !targetZone || selected.zone.id === targetZone.id) return;

    selected.zone.objects.splice(selected.index, 1);
    targetZone.objects.push(selected.object);
    this.persistAndRender();
  }

  private replaceSelectedShape(shape: ShapeKind): void {
    const selected = this.getSelectedRecord();
    if (!selected) return;

    const replacement = this.createDefaultObject(
      selected.zone.id,
      selected.object.id,
      selected.object.type,
      shape,
      selected.object.position,
    );

    selected.object.shape = replacement.shape;
    selected.object.size = replacement.size;
    selected.object.steps = replacement.steps;
    selected.object.stepSize = replacement.stepSize;
    selected.object.count = replacement.count;
    selected.object.points = replacement.points;
    this.persistAndRender();
  }

  private addObject(): void {
    const zone = this.getZoneById(this.addDraft.zoneId) ?? this.map.zones[0];
    if (!zone) return;

    const id = this.makeUniqueId(this.addDraft.id || this.makeSuggestedId(this.addDraft.shape));
    const position = {
      x: 0,
      y: round2((zone.yRange[0] + zone.yRange[1]) * 0.5),
    };

    const object = this.createDefaultObject(zone.id, id, this.addDraft.type, this.addDraft.shape, position);
    zone.objects.push(object);
    this.selectedId = object.id;
    this.addDraft.id = this.makeSuggestedId(this.addDraft.shape);
    this.persistAndRender();
    this.setStatus(`Added ${object.id}.`);
  }

  private deleteSelected(): void {
    const selected = this.getSelectedRecord();
    if (!selected) return;

    selected.zone.objects.splice(selected.index, 1);
    const nextObject = this.map.zones.flatMap((zone) => zone.objects)[0] ?? null;
    this.selectedId = nextObject?.id ?? null;
    this.persistAndRender();
    this.setStatus('Deleted selected object.');
  }

  private duplicateSelected(): void {
    const selected = this.getSelectedRecord();
    if (!selected) return;

    const duplicated = structuredClone(selected.object);
    duplicated.id = this.makeUniqueId(`${selected.object.id}_copy`);
    duplicated.position.x = round2(duplicated.position.x + 1.2);
    duplicated.position.y = round2(duplicated.position.y + 1.2);

    selected.zone.objects.splice(selected.index + 1, 0, duplicated);
    this.selectedId = duplicated.id;
    this.persistAndRender();
    this.setStatus(`Duplicated ${selected.object.id} as ${duplicated.id}.`);
  }

  private resetMap(): void {
    clearEditableMap();
    this.map = cloneBaseMap();
    this.selectedId = this.map.zones[0]?.objects[0]?.id ?? null;
    this.addDraft.zoneId = this.map.zones[0]?.id ?? '';
    this.addDraft.id = this.makeSuggestedId(this.addDraft.shape);
    this.placingSpawn = false;
    this.fitView();
    this.render();
    this.setStatus('Reset map to source data.');
  }

  private async copyMapJson(): Promise<void> {
    const text = JSON.stringify(this.map, null, 2);
    await navigator.clipboard.writeText(text);
    this.setStatus('Copied current map JSON to clipboard.');
  }

  private persistAndRender(): void {
    saveEditableMap(this.map);
    this.render();
  }

  private setStatus(text: string): void {
    this.statusText = text;
    this.renderToolbar();

    if (this.statusTimer != null) window.clearTimeout(this.statusTimer);
    this.statusTimer = window.setTimeout(() => {
      this.statusText = defaultStatusText();
      this.renderToolbar();
      this.statusTimer = null;
    }, 2200);
  }

  private setSpawnPoint(point: Vec2): void {
    this.map.playerStart.x = round2(point.x);
    this.map.playerStart.y = round2(point.y);
    this.placingSpawn = false;
    this.persistAndRender();
    this.setStatus(`Spawn moved to ${this.map.playerStart.x.toFixed(2)}, ${this.map.playerStart.y.toFixed(2)}.`);
  }

  private fitView(): void {
    const rect = this.viewport.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const bounds = this.map.worldBounds;
    const spanX = bounds.maxX - bounds.minX;
    const spanY = bounds.maxY - bounds.minY;
    this.view.centerX = (bounds.minX + bounds.maxX) * 0.5;
    this.view.centerY = (bounds.minY + bounds.maxY) * 0.5;
    this.view.zoom = clamp(Math.min((width - 80) / spanX, (height - 80) / spanY), 2, 80);
  }

  private adjustZoom(factor: number): void {
    this.view.zoom = clamp(this.view.zoom * factor, 2, 80);
    this.renderViewport();
  }

  private clientToWorld(clientX: number, clientY: number): Vec2 {
    const rect = this.viewport.getBoundingClientRect();
    const x = (clientX - rect.left - rect.width * 0.5) / this.view.zoom + this.view.centerX;
    const y = (rect.height * 0.5 - (clientY - rect.top)) / this.view.zoom + this.view.centerY;
    return { x, y };
  }

  private getBounds(object: MapObject): Bounds {
    switch (object.shape) {
      case 'circle': {
        const r = object.size?.radius ?? 1;
        return { width: r * 2, height: r * 2 };
      }
      case 'ring': {
        const r = object.size?.outerRadius ?? 2;
        return { width: r * 2, height: r * 2 };
      }
      case 'stackedRings': {
        const outer = object.size?.outerRadius ?? 1.1;
        const inner = object.size?.innerRadius ?? 0.55;
        const step = (outer - inner) + inner * 0.6;
        const count = object.count ?? 3;
        return { width: outer * 2, height: outer * 2 + Math.max(0, count - 1) * step * 1.1 };
      }
      case 'staircase': {
        const steps = object.steps ?? 4;
        const stepW = object.stepSize?.width ?? 1.2;
        const stepH = object.stepSize?.height ?? 0.7;
        return {
          width: stepW + (steps - 1) * stepW * 0.6,
          height: stepH * steps,
        };
      }
      case 'irregularPolygon': {
        const points = object.points ?? [];
        if (!points.length) return { width: 2, height: 2 };
        const xs = points.map((point) => point[0]);
        const ys = points.map((point) => point[1]);
        return {
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        };
      }
      default:
        {
          const fallbackRadius = object.size?.radius;
          return {
            width: object.size?.width ?? 2,
            height: object.size?.height ?? (fallbackRadius != null ? fallbackRadius * 2 : 2),
          };
        }
    }
  }

  private createDefaultObject(
    zoneId: string,
    id: string,
    type: ObjectType,
    shape: ShapeKind,
    position: Vec2,
  ): MapObject {
    const base: MapObject = {
      id,
      type,
      shape,
      position: { x: position.x, y: position.y },
      rotation: 0,
      material: defaultMaterial(shape, type),
    };

    switch (shape) {
      case 'rect':
        base.size = { width: 4, height: 0.6 };
        break;
      case 'roundedRect':
        base.size = { width: 4, height: 1.2 };
        break;
      case 'semicircle':
        base.size = { width: 5, height: 2.5 };
        break;
      case 'circle':
        base.size = { radius: 1.3 };
        break;
      case 'cylinder':
        base.size = { width: 5, height: 0.8 };
        break;
      case 'ring':
        base.size = { outerRadius: 2.1, innerRadius: 1.2 };
        break;
      case 'stackedRings':
        base.size = { outerRadius: 1.2, innerRadius: 0.6 };
        base.count = 3;
        break;
      case 'staircase':
        base.steps = 4;
        base.stepSize = { width: 1.3, height: 0.7 };
        break;
      case 'curvedHook':
        base.size = { width: 2.0, height: 2.8 };
        break;
      case 'ladder':
        base.size = { width: 2.4, height: 6.4 };
        break;
      case 'uHook':
        base.size = { width: 2.0, height: 2.2 };
        break;
      case 'triangleRoof':
        base.size = { width: 8, height: 4 };
        break;
      case 'concaveDish':
        base.size = { width: 3.8, height: 1.7 };
        break;
      case 'irregularPolygon':
        base.points = [
          [-2.2, -1.4],
          [1.6, -1.2],
          [2.2, 0.4],
          [0.8, 2.0],
          [-1.8, 1.4],
        ];
        break;
      case 'trussTower':
        base.size = { width: 4.4, height: 11 };
        break;
      case 'flag':
        base.type = 'decorative';
        base.size = { width: 1.5, height: 2 };
        break;
      case 'arch':
        base.type = 'decorative';
        base.size = { width: 5.5, height: 4.2 };
        break;
    }

    if (shape === 'flag' || shape === 'arch') {
      const zone = this.getZoneById(zoneId);
      if (zone) base.position.y = zone.yRange[1] - 1;
    }

    return base;
  }

  private makeSuggestedId(shape: ShapeKind): string {
    return `new_${shape}_${Date.now().toString(36).slice(-4)}`;
  }

  private makeUniqueId(baseId: string): string {
    const normalized = baseId.replace(/\s+/g, '_').toLowerCase() || 'new_object';
    let candidate = normalized;
    let index = 2;
    while (this.findObject(candidate)) {
      candidate = `${normalized}_${index}`;
      index += 1;
    }
    return candidate;
  }

  private readNumber(value: string, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function objectFill(type: ObjectType): string {
  switch (type) {
    case 'thin':
      return '#9ec5ff';
    case 'round':
      return '#cba36f';
    case 'slippery':
      return '#87d0de';
    case 'decorative':
      return '#9a9a9a';
    default:
      return '#85705a';
  }
}

function objectStroke(type: ObjectType): string {
  switch (type) {
    case 'slippery':
      return '#1d5360';
    case 'decorative':
      return '#4b4b4b';
    default:
      return '#1a140f';
  }
}

function defaultMaterial(shape: ShapeKind, type: ObjectType): string {
  if (type === 'slippery') return 'ice';
  if (type === 'decorative') return shape === 'flag' ? 'white cloth' : 'soft glow';
  if (shape === 'triangleRoof') return 'roof tiles';
  if (shape === 'ring' || shape === 'stackedRings') return 'concrete';
  if (shape === 'circle') return 'stone';
  return 'wood';
}

function defaultStatusText(): string {
  return 'Left-drag objects to move them. Right-drag to pan. Mouse wheel zooms.';
}

function svgRect(width: number, height: number, fill: string, stroke: string, radius: number): string {
  return `
    <rect
      x="${-width / 2}"
      y="${-height / 2}"
      width="${width}"
      height="${height}"
      rx="${radius}"
      fill="${fill}"
      stroke="${stroke}"
      vector-effect="non-scaling-stroke"
    />
  `;
}

function svgCircle(radius: number, fill: string, stroke: string): string {
  return `
    <circle
      r="${radius}"
      fill="${fill}"
      stroke="${stroke}"
      vector-effect="non-scaling-stroke"
    />
  `;
}

function svgRing(outerRadius: number, innerRadius: number, fill: string): string {
  const mean = (outerRadius + innerRadius) * 0.5;
  const thickness = Math.max(0.12, outerRadius - innerRadius);
  return `
    <circle
      r="${mean}"
      fill="none"
      stroke="${fill}"
      stroke-width="${thickness}"
      vector-effect="non-scaling-stroke"
    />
  `;
}

function svgStackedRings(count: number, outerRadius: number, innerRadius: number, fill: string): string {
  const step = (outerRadius - innerRadius) + innerRadius * 0.6;
  const offset = ((count - 1) * step * 1.1) * 0.5;
  return Array.from({ length: count }, (_, index) => `
    <g transform="translate(0 ${index * step * 1.1 - offset})">
      ${svgRing(outerRadius, innerRadius, fill)}
    </g>
  `).join('');
}

function svgStaircase(steps: number, stepWidth: number, stepHeight: number, fill: string, stroke: string): string {
  const totalWidth = stepWidth + (steps - 1) * stepWidth * 0.6;
  const totalHeight = stepHeight * steps;
  const startX = -totalWidth * 0.5;
  const startY = -totalHeight * 0.5;

  return Array.from({ length: steps }, (_, index) => {
    const x = startX + index * stepWidth * 0.6;
    const y = startY + index * stepHeight;
    return `
      <rect
        x="${x}"
        y="${y}"
        width="${stepWidth}"
        height="${stepHeight}"
        fill="${fill}"
        stroke="${stroke}"
        vector-effect="non-scaling-stroke"
      />
    `;
  }).join('');
}

function svgLadder(width: number, height: number, fill: string, stroke: string): string {
  const rail = Math.max(width * 0.08, 0.08);
  const rungs = Math.max(2, Math.floor(height / 0.7));
  const parts = [
    `<g transform="translate(${width / 2 - rail / 2} 0)">${svgRect(rail, height, fill, stroke, 0)}</g>`,
    `<g transform="translate(${-width / 2 + rail / 2} 0)">${svgRect(rail, height, fill, stroke, 0)}</g>`,
  ];

  for (let i = 0; i <= rungs; i++) {
    const y = -height / 2 + (i / rungs) * height;
    parts.push(`
      <rect
        x="${-width / 2}"
        y="${y - rail / 2}"
        width="${width}"
        height="${rail}"
        fill="${fill}"
        stroke="${stroke}"
        vector-effect="non-scaling-stroke"
      />
    `);
  }

  return parts.join('');
}

function svgUHook(width: number, height: number, fill: string, stroke: string): string {
  const t = Math.max(width * 0.18, 0.12);
  return `
    <rect x="${-width / 2}" y="${-height / 2}" width="${t}" height="${height}" fill="${fill}" stroke="${stroke}" vector-effect="non-scaling-stroke" />
    <rect x="${width / 2 - t}" y="${-height / 2}" width="${t}" height="${height}" fill="${fill}" stroke="${stroke}" vector-effect="non-scaling-stroke" />
    <rect x="${-width / 2}" y="${-height / 2}" width="${width}" height="${t}" fill="${fill}" stroke="${stroke}" vector-effect="non-scaling-stroke" />
  `;
}

function svgCurvedHook(width: number, height: number, fill: string, stroke: string): string {
  const stem = Math.max(width * 0.14, 0.1);
  return `
    <rect x="${-stem / 2}" y="${-height / 2}" width="${stem}" height="${height}" fill="${fill}" stroke="${stroke}" vector-effect="non-scaling-stroke" />
    <path
      d="M 0 ${height / 2 - stem} Q ${width / 2} ${height / 2 - stem * 0.5} ${width / 2} 0"
      fill="none"
      stroke="${stroke}"
      stroke-width="${stem}"
      stroke-linecap="round"
      vector-effect="non-scaling-stroke"
    />
  `;
}

function svgDish(width: number, height: number, fill: string, stroke: string): string {
  return `
    <path
      d="M ${-width / 2} ${-height / 3} Q 0 ${height / 2} ${width / 2} ${-height / 3}"
      fill="none"
      stroke="${stroke}"
      stroke-width="${Math.max(0.14, height * 0.18)}"
      stroke-linecap="round"
      vector-effect="non-scaling-stroke"
    />
    <path
      d="M ${-width / 2} ${-height / 3} Q 0 ${height / 2} ${width / 2} ${-height / 3} L 0 ${-height / 2} Z"
      fill="${fill}"
      fill-opacity="0.35"
      stroke="none"
    />
  `;
}

function svgPolygon(points: [number, number][], fill: string, stroke: string): string {
  const pointText = points.map((point) => `${point[0]},${point[1]}`).join(' ');
  return `
    <polygon
      points="${pointText}"
      fill="${fill}"
      stroke="${stroke}"
      vector-effect="non-scaling-stroke"
    />
  `;
}

function svgTower(width: number, height: number, fill: string, stroke: string): string {
  const rail = Math.max(width * 0.1, 0.12);
  const bars = Math.max(3, Math.floor(height / 2));
  const parts = [
    `<rect x="${-width / 2}" y="${-height / 2}" width="${rail}" height="${height}" fill="${fill}" stroke="${stroke}" vector-effect="non-scaling-stroke" />`,
    `<rect x="${width / 2 - rail}" y="${-height / 2}" width="${rail}" height="${height}" fill="${fill}" stroke="${stroke}" vector-effect="non-scaling-stroke" />`,
  ];

  for (let i = 0; i <= bars; i++) {
    const y = -height / 2 + (i / bars) * height;
    parts.push(`<line x1="${-width / 2}" y1="${y}" x2="${width / 2}" y2="${y}" stroke="${stroke}" vector-effect="non-scaling-stroke" />`);
    if (i < bars) {
      const nextY = -height / 2 + ((i + 1) / bars) * height;
      if (i % 2 === 0) {
        parts.push(`<line x1="${-width / 2}" y1="${y}" x2="${width / 2}" y2="${nextY}" stroke="${stroke}" vector-effect="non-scaling-stroke" />`);
      } else {
        parts.push(`<line x1="${width / 2}" y1="${y}" x2="${-width / 2}" y2="${nextY}" stroke="${stroke}" vector-effect="non-scaling-stroke" />`);
      }
    }
  }

  return parts.join('');
}

function svgFlag(width: number, height: number, fill: string, stroke: string): string {
  return `
    <line x1="0" y1="${-height / 2}" x2="0" y2="${height / 2}" stroke="${stroke}" vector-effect="non-scaling-stroke" />
    <polygon
      points="0,${height / 2 - 0.2} ${width},${height / 2 - height * 0.15} ${width * 0.7},${height / 2 - height * 0.45} 0,${height / 2 - height * 0.3}"
      fill="${fill}"
      stroke="${stroke}"
      vector-effect="non-scaling-stroke"
    />
  `;
}

function svgArch(width: number, height: number, fill: string, stroke: string): string {
  return `
    <rect x="${-width / 2}" y="${-height / 2}" width="0.22" height="${height}" fill="${fill}" stroke="${stroke}" vector-effect="non-scaling-stroke" />
    <rect x="${width / 2 - 0.22}" y="${-height / 2}" width="0.22" height="${height}" fill="${fill}" stroke="${stroke}" vector-effect="non-scaling-stroke" />
    <path
      d="M ${-width / 2} ${height / 2 - 0.2} Q 0 ${height / 2 + height * 0.35} ${width / 2} ${height / 2 - 0.2}"
      fill="none"
      stroke="${stroke}"
      stroke-width="0.22"
      vector-effect="non-scaling-stroke"
    />
  `;
}
