import { forwardRef, type ComponentProps } from 'react'

/** Container de scroll principal da listagem (cadastros, etc.). */
const PageScrollRoot = forwardRef<HTMLDivElement, ComponentProps<'div'>>(
  function PageScrollRoot({ children, className, ...rest }, ref) {
    return (
      <div ref={ref} className={className} {...rest}>
        {children}
      </div>
    )
  },
)

export default PageScrollRoot
