module.exports = {
  run: [
    {
      when: "{{exists('app/env')}}",
      method: "fs.rm",
      params: {
        path: "app/env"
      }
    },
    {
      method: "notify",
      params: {
        html: "Dependencies reset. Run Install before starting again."
      }
    }
  ]
}
