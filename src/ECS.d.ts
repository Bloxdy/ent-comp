// Type definitions for ent-comp ECS (CommonJS build)
// Project: https://github.com/fenomas/ent-comp

declare class ECS {
	constructor();

	/** Map of component definitions, alias: `comps`. */
	components: Record<string, ECS.ComponentDefinition<any>>;
	comps: Record<string, ECS.ComponentDefinition<any>>;

	/** Internal/debug fields (unstable). */
	_storage: any;
	_systems: string[];
	_renderSystems: string[];

	/** Create a new entity id; optionally add components by name. */
	createEntity(compList?: string[]): ECS.EntityId;

	/** Delete an entity (removes all its components). */
	deleteEntity(entID: ECS.EntityId): this;

	/** Define a new component. Returns the component name. */
	createComponent<T = any>(def: ECS.ComponentDefinition<T>): string;

	/** Overwrite an existing component definition in-place. Returns the name. */
	overwriteComponent<T = any>(compName: string, def: ECS.ComponentDefinition<T>): string;

	/** Delete a component definition and remove it from all entities. */
	deleteComponent(compName: string): this;

	/** Add a component to an entity, optionally providing initial state. */
	addComponent<T = any>(
		entID: ECS.EntityId,
		compName: string,
		state?: Partial<T>
	): this;

	/** Check whether an entity has a component. */
	hasComponent(entID: ECS.EntityId, compName: string): boolean;

	/** Remove a component from an entity. */
	removeComponent(entID: ECS.EntityId, compName: string): this;

	/**
	 * Get component state for an entity.
	 * - For normal components: the state object (or `undefined`).
	 * - For multi components: an array of state objects (or `undefined`).
	 */
	getState<T = any>(
		entID: ECS.EntityId,
		compName: string
	): ECS.StateWithId<T> | Array<ECS.StateWithId<T>> | undefined;

	/**
	 * Get a list of states for all entities with the component.
	 * For multi components this is an array of per-entity arrays.
	 */
	getStatesList<T = any>(
		compName: string
	): Array<ECS.StateWithId<T> | Array<ECS.StateWithId<T>>>;

	/** Fast accessor for a component's state: (id) => state/array/undefined. */
	getStateAccessor<T = any>(
		compName: string
	): (id: ECS.EntityId) => ECS.StateWithId<T> | Array<ECS.StateWithId<T>> | undefined;

	/** Fast accessor for `hasComponent`: (id) => boolean. */
	getComponentAccessor(compName: string): (id: ECS.EntityId) => boolean;

	/** Run all `system` functions in order. */
	tick(dt?: any): this;

	/** Run all `renderSystem` functions in order. */
	render(dt?: any): this;

	/** Remove a single instance from a multi-component. */
	removeMultiComponent(entID: ECS.EntityId, compName: string, index: number): this;
}

declare namespace ECS {
	/** Entity IDs can be numbers (default) or strings (user-supplied). */
	type EntityId = number | string;

	/** State object guaranteed to include the owning entity id as `__id`. */
	type StateWithId<T> = T & { __id: EntityId };

	/** A constructor that creates a state object (must include `__id`). */
	interface StateConstructor<T> {
		new (): StateWithId<T>;
	}

	/** Component definition used with `createComponent` / `overwriteComponent`. */
	interface ComponentDefinition<T = any> {
		/** Unique component name. */
		name: string;

		/** Default state values (merged for each new state). */
		state?: Partial<T>;

		/** Custom state constructor (constructed object MUST have `__id`). */
		stateConstructor?: StateConstructor<T>;

		/** Call order among systems (lower runs earlier). Defaults to 99. */
		order?: number;

		/**
		 * If true, an entity can have multiple states for this component.
		 * Affects the return type of `getState` / `getStateAccessor`.
		 */
		multi?: boolean;

		/** Called after a state is added. */
		onAdd?(id: EntityId, state: StateWithId<T>): void;

		/** Called before a state is removed. */
		onRemove?(id: EntityId, state: StateWithId<T>): void;

		/**
		 * Per-tick logic. Receives `dt` and the component's states list
		 * (same shape as `getStatesList(compName)`).
		 */
		system?(dt: any, states: Array<StateWithId<T> | Array<StateWithId<T>>>): void;

		/**
		 * Per-render logic. Receives `dt` and the component's states list
		 * (same shape as `getStatesList(compName)`).
		 */
		renderSystem?(dt: any, states: Array<StateWithId<T> | Array<StateWithId<T>>>): void;
	}
}

export = ECS;
