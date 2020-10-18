Vue.component("spinner", {
  props: ["size"],
  template: `
      <div class="spinner" v-bind:style="{ width: (size * 3.89) + 'px' }">
        <div class="bounce1" v-bind:style="{ width: size + 'px', height: size + 'px' }"></div>
        <div class="bounce2" v-bind:style="{ width: size + 'px', height: size + 'px' }"></div>
        <div class="bounce3" v-bind:style="{ width: size + 'px', height: size + 'px' }"></div>
      </div>
    `,
});
